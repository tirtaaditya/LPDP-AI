const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const db = require('../db');
const config = require('../config');
const fileService = require('./file.service');
const { getAiRuntime } = require('./openai.service');

function pickVisionModel(configuredModel) {
  const model = String(configuredModel || 'gpt-4o-mini');
  if (model.includes('mini') || model.includes('nano')) return 'gpt-4o';
  return model;
}

function wantsPdfGeneration(message, force = false) {
  if (force) return true;
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^\/(pdf|dokumen|document)\b/i.test(text)) return true;

  const lower = text.toLowerCase();
  const patterns = [
    /\b(buatkan|buatkanlah|generate|create|bikin|buat)\b.*\b(pdf|dokumen pdf|file pdf)\b/i,
    /\b(pdf|dokumen pdf|file pdf)\b.*\b(buat|buatkan|generate|create|bikin)\b/i,
    /\bexport\s+(to\s+)?pdf\b/i,
    /\b(jadiin|jadikan)\s+(jadi\s+)?pdf\b/i,
  ];
  return patterns.some((re) => re.test(lower));
}

function wantsImageGeneration(message, force = false) {
  if (force) return true;
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^\/(image|gambar|img)\b/i.test(text)) return true;
  // Prefer PDF when both could match ("buat pdf" vs image)
  if (wantsPdfGeneration(text, false)) return false;

  const lower = text.toLowerCase();
  const patterns = [
    /\b(buatkan|buatkanlah|generate|create|draw|lukis|gambarin|gambarin)\b.*\b(gambar|image|foto|illustration|ilustrasi)\b/i,
    /\b(gambar|image|foto|illustration|ilustrasi)\b.*\b(buat|buatkan|generate|create|draw)\b/i,
    /\b(buat|bikin)\s+(sebuah\s+)?(gambar|image|foto|ilustrasi)\b/i,
    /\bgenerate\s+(an?\s+)?image\b/i,
    /\bdraw\s+(me\s+)?(an?\s+)?/i,
    /\btext[\s-]?to[\s-]?image\b/i,
  ];
  return patterns.some((re) => re.test(lower));
}

function cleanImagePrompt(message) {
  return String(message || '')
    .replace(/^\/(image|gambar|img)\s*/i, '')
    .trim();
}

function cleanPdfPrompt(message) {
  return String(message || '')
    .replace(/^\/(pdf|dokumen|document)\s*/i, '')
    .replace(
      /\b(buatkan|buatkanlah|tolong|please)\s+(sebuah\s+|satu\s+)?(pdf|dokumen pdf|file pdf)\s*(dari|tentang|isi|:)?\s*/i,
      ''
    )
    .trim();
}

function resolvePdfFont() {
  const candidates = [
    path.join(config.projectRoot, 'public', 'fonts', 'NotoSans-Regular.ttf'),
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parsePdfDocumentJson(raw) {
  const text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && (parsed.title || parsed.body || parsed.sections)) {
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .map((s) => ({
              heading: String(s?.heading || s?.title || '').trim(),
              body: String(s?.body || s?.text || '').trim(),
              image:
                s?.image === null || s?.image === undefined || s?.image === ''
                  ? null
                  : Number(s.image),
            }))
            .filter((s) => s.heading || s.body || Number.isFinite(s.image))
        : [];
      return {
        title: String(parsed.title || 'Dokumen AI LPDP').trim(),
        body: String(parsed.body || '').trim(),
        sections,
      };
    }
  } catch {
    // fall through
  }
  const titleMatch = text.match(/^TITLE:\s*(.+)$/im);
  const title = titleMatch ? titleMatch[1].trim() : 'Dokumen AI LPDP';
  const body = titleMatch
    ? text.replace(/^TITLE:\s*.+$/im, '').trim()
    : text;
  return { title, body: body || text, sections: [] };
}

async function saveGeneratedPdfBuffer(buffer) {
  const dir = path.join(config.projectRoot, 'public', 'generated');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, buffer);
  return {
    fileName,
    url: `/public/generated/${fileName}`,
    mime: 'application/pdf',
  };
}

function pdfContentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function pdfEnsureSpace(doc, needed = 120) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function pdfDrawImage(doc, img, caption) {
  if (!img?.buffer || !Buffer.isBuffer(img.buffer)) return;
  pdfEnsureSpace(doc, 160);
  const maxW = pdfContentWidth(doc);
  const maxH = Math.min(420, doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 80);
  try {
    if (caption) {
      doc
        .fillColor('#0e7490')
        .fontSize(9)
        .text(String(caption).slice(0, 180), { align: 'left' });
      doc.moveDown(0.3);
    }
    doc.image(img.buffer, {
      fit: [maxW, maxH],
      align: 'center',
    });
    doc.moveDown(0.8);
  } catch (err) {
    doc
      .fillColor('#be123c')
      .fontSize(9)
      .text(
        `[Gambar gagal disisipkan: ${img.fileName || 'file'} — ${err.message || 'error'}]`
      );
    doc.moveDown(0.5);
  }
}

function buildPdfBuffer({ title, body, sections = [], images = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: title,
        Author: 'AI LPDP Admin Chat',
        Creator: 'AI LPDP',
      },
      autoFirstPage: true,
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontPath = resolvePdfFont();
    if (fontPath) {
      doc.font(fontPath);
    } else {
      doc.font('Helvetica');
    }

    const safeTitle = String(title || 'Dokumen AI LPDP').slice(0, 200);
    const imageList = Array.isArray(images) ? images.filter((i) => i && i.buffer) : [];
    const usedImage = new Set();

    doc.fillColor('#0e7490').fontSize(11).text('AI LPDP · Generated Document', {
      align: 'left',
    });
    doc.moveDown(0.3);
    doc
      .strokeColor('#a5f3fc')
      .lineWidth(1)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(1);

    doc.fillColor('#0f172a').fontSize(18).text(safeTitle, { align: 'left' });
    doc.moveDown(0.4);
    doc
      .fillColor('#64748b')
      .fontSize(9)
      .text(
        `Dibuat: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}` +
          (imageList.length ? ` · ${imageList.length} gambar` : ''),
        { align: 'left' }
      );
    doc.moveDown(1);

    if (Array.isArray(sections) && sections.length) {
      for (const section of sections) {
        pdfEnsureSpace(doc, 80);
        if (section.heading) {
          doc
            .fillColor('#0f172a')
            .fontSize(13)
            .text(String(section.heading).slice(0, 200), { align: 'left' });
          doc.moveDown(0.35);
        }
        if (section.body) {
          doc
            .fillColor('#1e293b')
            .fontSize(11)
            .text(String(section.body).slice(0, 20000), {
              align: 'left',
              lineGap: 3,
            });
          doc.moveDown(0.5);
        }
        if (Number.isFinite(section.image) && imageList[section.image]) {
          usedImage.add(section.image);
          pdfDrawImage(
            doc,
            imageList[section.image],
            `Gambar ${section.image + 1}: ${imageList[section.image].fileName || ''}`
          );
        }
      }
    } else {
      const safeBody = String(body || '').slice(0, 80000);
      doc.fillColor('#1e293b').fontSize(11).text(safeBody || '(kosong)', {
        align: 'left',
        lineGap: 3,
      });
      doc.moveDown(1);
    }

    const remaining = imageList
      .map((img, idx) => ({ img, idx }))
      .filter(({ idx }) => !usedImage.has(idx));

    if (remaining.length) {
      pdfEnsureSpace(doc, 60);
      doc
        .fillColor('#0f172a')
        .fontSize(13)
        .text(
          Array.isArray(sections) && sections.length
            ? 'Lampiran gambar lainnya'
            : 'Lampiran screenshot',
          { align: 'left' }
        );
      doc.moveDown(0.6);
      for (const { img, idx } of remaining) {
        pdfDrawImage(doc, img, `Gambar ${idx + 1}: ${img.fileName || ''}`);
      }
    }

    doc.end();
  });
}

async function generatePdf({
  prompt,
  history = [],
  fileText = '',
  imageFiles = [],
  visionFiles = [],
}) {
  const runtime = await getAiRuntime();
  const { provider, client } = runtime;
  let model = runtime.model;
  const topic = cleanPdfPrompt(prompt) || String(prompt || '').trim();
  const images = (Array.isArray(imageFiles) && imageFiles.length
    ? imageFiles
    : (visionFiles || []).filter(
        (f) =>
          f &&
          (f.kind === 'image' ||
            String(f.mime || '').startsWith('image/') ||
            fileService.isImageExt(
              path.extname(f.fileName || '').replace('.', '').toLowerCase()
            ))
      )
  ).filter((f) => f && f.buffer);

  if (!topic && !fileText && !images.length) {
    const err = new Error(
      'PDF prompt is too short. Describe the document, attach screenshots, or use /pdf <isi dokumen>.'
    );
    err.code = 'PDF_PROMPT_SHORT';
    throw err;
  }

  const temperature = Number(await db.getSetting('temperature', '0.2'));
  const maxTokens = Math.min(
    4000,
    Math.max(800, Number(await db.getSetting('max_tokens', '2000')) || 2000)
  );

  const imageCatalog = images
    .map((img, i) => `[${i}] ${img.fileName || `image_${i + 1}`}`)
    .join('\n');

  const systemPrompt =
    'You are a technical writer for LPDP AI Admin Manual Book. Write clear Indonesian documentation. ' +
    'Return ONLY valid JSON (no markdown fences) with this shape:\n' +
    '{"title":"string","sections":[{"heading":"string","body":"string","image":0}]}\n' +
    'Rules: "image" is the 0-based index of an attached screenshot (or null if no image for that section). ' +
    'Use attached screenshots in order when writing a manual. Cover each screen/module. ' +
    'Do not invent confidential personal data. Keep body practical (langkah + penjelasan singkat).';

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const turn of history.slice(-8)) {
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    messages.push({
      role: turn.role,
      content: String(turn.content).slice(0, 8000),
    });
  }

  const textBrief = [
    `Buatkan dokumen PDF (manual book) dengan instruksi:\n${topic || '(lihat screenshot/lampiran)'}`,
    images.length
      ? `\n\nAttached screenshots (gunakan index di field "image"):\n${imageCatalog}`
      : '',
    fileText
      ? `\n\n--- KONTEKS FILE ---\n${String(fileText).slice(0, 20000)}`
      : '',
  ]
    .join('')
    .trim();

  const useVision = provider === 'openai' && images.length > 0;
  if (useVision) {
    model = pickVisionModel(model);
  }

  let userContent;
  if (useVision) {
    userContent = [
      { type: 'text', text: textBrief },
      ...images.slice(0, 15).map((f) => fileService.toVisionContentPart(f)),
    ];
  } else {
    userContent = textBrief;
  }

  messages.push({ role: 'user', content: userContent });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    });
  } catch (err) {
    if (useVision) {
      // Retry text-only if vision payload too large; images still embedded in PDF.
      completion = await client.chat.completions.create({
        model: runtime.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(1, -1),
          {
            role: 'user',
            content:
              textBrief +
              '\n\n(Catatan: screenshot dilampirkan ke PDF secara otomatis; tulis sections dengan image index.)',
          },
        ],
      });
    } else {
      throw err;
    }
  }

  const raw = completion.choices?.[0]?.message?.content || '';
  const parsed = parsePdfDocumentJson(raw);
  const { title, body, sections } = parsed;
  if (!body && !(sections && sections.length)) {
    const err = new Error('AI did not return document body for PDF.');
    err.code = 'PDF_EMPTY_BODY';
    throw err;
  }

  const pdfBuffer = await buildPdfBuffer({
    title,
    body,
    sections,
    images,
  });
  const saved = await saveGeneratedPdfBuffer(pdfBuffer);

  return {
    reply:
      `PDF berhasil dibuat.\n\nJudul: ${title}\n` +
      (images.length
        ? `Gambar tersisip: ${images.length} file.\n\n`
        : '\n') +
      'Unduh file di bawah, atau buka di tab baru.',
    images: [],
    documents: [saved],
    meta: {
      provider,
      model,
      usage: completion.usage || null,
      mode: 'pdf_generation',
      title,
      embedded_images: images.map((i) => i.fileName),
    },
  };
}

/**
 * Process multer files into text + optional vision PDF buffers + embeddable images.
 */
async function processChatUploads(files = []) {
  const textParts = [];
  const visionFiles = [];
  const imageFiles = [];
  const meta = [];

  for (const file of files) {
    const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
    const buffer = require('fs').readFileSync(file.path);
    try {
      const extracted = await fileService.extractTextFromBuffer(
        buffer,
        ext,
        file.originalname || 'file'
      );
      meta.push({
        name: file.originalname,
        size: file.size,
        ext,
        scanned: Boolean(extracted.needsVision),
      });

      if (fileService.isImageExt(ext)) {
        imageFiles.push({
          fileName: file.originalname || 'image',
          mime: extracted.mime || fileService.mimeFromExt(ext),
          buffer: extracted.buffer || buffer,
          kind: 'image',
        });
      }

      if (extracted.needsVision) {
        visionFiles.push({
          fileName: file.originalname || 'file',
          mime: extracted.mime || fileService.mimeFromExt(ext),
          buffer: extracted.buffer || buffer,
          kind: extracted.kind || (fileService.isImageExt(ext) ? 'image' : 'pdf'),
        });
        const label = fileService.isImageExt(ext) ? 'image' : 'scanned PDF';
        textParts.push(
          `--- FILE (${label}): ${file.originalname} ---\n[Attached for AI vision reading]`
        );
      } else if (extracted.text) {
        textParts.push(
          `--- FILE: ${file.originalname} ---\n\n${extracted.text}`
        );
      }
    } finally {
      fileService.safeUnlink(file.path);
    }
  }

  return {
    fileText: textParts.join('\n\n'),
    visionFiles,
    imageFiles,
    filesMeta: meta,
  };
}

async function saveGeneratedImage(b64, ext = 'png') {
  const dir = path.join(config.projectRoot, 'public', 'generated');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, Buffer.from(b64, 'base64'));
  return {
    fileName,
    url: `/public/generated/${fileName}`,
    mime: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png',
  };
}

function buildImagePayload(model, prompt, imageSize) {
  const isGptImage = /^gpt-image/i.test(model) || /chatgpt-image/i.test(model);
  const isDalle3 = /dall-e-3/i.test(model);
  const isDalle2 = /dall-e-2/i.test(model);

  const payload = {
    model,
    prompt: prompt.slice(0, 3500),
    n: 1,
  };

  if (isGptImage) {
    // GPT Image models return b64 by default; response_format is not used.
    const allowed = ['1024x1024', '1536x1024', '1024x1536', 'auto'];
    payload.size = allowed.includes(imageSize) ? imageSize : '1024x1024';
    return payload;
  }

  if (isDalle3) {
    payload.response_format = 'b64_json';
    const allowed = ['1024x1024', '1024x1792', '1792x1024'];
    payload.size = allowed.includes(imageSize) ? imageSize : '1024x1024';
    return payload;
  }

  if (isDalle2) {
    payload.response_format = 'b64_json';
    const allowed = ['256x256', '512x512', '1024x1024'];
    payload.size = allowed.includes(imageSize) ? imageSize : '1024x1024';
    return payload;
  }

  // Unknown model: minimal payload
  payload.size = imageSize || '1024x1024';
  return payload;
}

function isModelMissingError(err) {
  const msg = String(err?.message || err || '');
  return /does not exist|model_not_found|invalid model|not available/i.test(msg);
}

async function generateImage({ prompt, size }) {
  const runtime = await getAiRuntime();
  if (runtime.provider !== 'openai') {
    const err = new Error(
      'Image generation requires OpenAI provider. Switch AI Provider to OpenAI in Settings.'
    );
    err.code = 'IMAGE_PROVIDER_UNSUPPORTED';
    throw err;
  }

  const preferred =
    String(await db.getSetting('openai_image_model', 'gpt-image-1')).trim() ||
    'gpt-image-1';
  const imageSize =
    size ||
    String(await db.getSetting('openai_image_size', '1024x1024')).trim() ||
    '1024x1024';

  const cleanPrompt = cleanImagePrompt(prompt);
  if (!cleanPrompt || cleanPrompt.length < 3) {
    const err = new Error('Image prompt is too short. Describe the image you want.');
    err.code = 'IMAGE_PROMPT_INVALID';
    throw err;
  }

  // Try preferred model, then common fallbacks (some orgs/API gateways lack dall-e-3)
  const candidates = [
    preferred,
    'gpt-image-1',
    'gpt-image-1.5',
    'gpt-image-2',
    'dall-e-2',
    'dall-e-3',
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let result = null;
  let usedModel = preferred;
  let usedPayload = null;
  const tried = [];
  let lastErr = null;

  for (const model of candidates) {
    const payload = buildImagePayload(model, cleanPrompt, imageSize);
    tried.push(model);
    try {
      result = await runtime.client.images.generate(payload);
      usedModel = model;
      usedPayload = payload;
      break;
    } catch (err) {
      lastErr = err;
      if (/response_format|unknown_parameter|unknown parameter/i.test(err.message || '')) {
        try {
          const retryPayload = { ...payload };
          delete retryPayload.response_format;
          result = await runtime.client.images.generate(retryPayload);
          usedModel = model;
          usedPayload = retryPayload;
          break;
        } catch (err2) {
          lastErr = err2;
          if (!isModelMissingError(err2)) throw err2;
          continue;
        }
      }
      if (isModelMissingError(err)) continue;
      throw err;
    }
  }

  if (!result) {
    const err = new Error(
      `${lastErr?.message || 'Image model unavailable'}. Tried: ${tried.join(', ')}. ` +
        'Set Image model in Admin → Settings to a model your API key supports ' +
        '(e.g. gpt-image-1, gpt-image-2, dall-e-2).'
    );
    err.code = 'IMAGE_MODEL_UNAVAILABLE';
    throw err;
  }

  const item = result.data?.[0];
  if (!item) {
    const err = new Error('Image generation returned empty result');
    err.code = 'IMAGE_EMPTY';
    throw err;
  }

  let b64 = item.b64_json;
  if (!b64 && item.url) {
    const res = await fetch(item.url);
    if (!res.ok) {
      const err = new Error(`Failed to download generated image (${res.status})`);
      err.code = 'IMAGE_DOWNLOAD_FAILED';
      throw err;
    }
    b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  }
  if (!b64) {
    const err = new Error('Image generation returned no image data');
    err.code = 'IMAGE_EMPTY';
    throw err;
  }

  const saved = await saveGeneratedImage(b64, 'png');
  // Persist working model so next request is faster
  if (usedModel !== preferred) {
    try {
      await db.setSetting('openai_image_model', usedModel);
    } catch {
      // ignore
    }
  }

  return {
    reply: item.revised_prompt
      ? `Gambar berhasil dibuat (model: ${usedModel}).\n\nPrompt (revised):\n${item.revised_prompt}`
      : `Gambar berhasil dibuat (model: ${usedModel}).`,
    images: [saved],
    documents: [],
    meta: {
      provider: 'openai',
      model: usedModel,
      size: usedPayload?.size || imageSize,
      mode: 'image_generation',
      revised_prompt: item.revised_prompt || null,
      tried_models: tried,
    },
  };
}

async function chat({
  message,
  history = [],
  fileText = '',
  visionFiles = [],
  imageFiles = [],
  forceImage = false,
  forcePdf = false,
}) {
  const textMessage = String(message || '').trim();

  if (wantsPdfGeneration(textMessage, forcePdf)) {
    return generatePdf({
      prompt: textMessage,
      history,
      fileText,
      imageFiles,
      visionFiles,
    });
  }

  if (wantsImageGeneration(textMessage, forceImage)) {
    return generateImage({ prompt: textMessage });
  }

  const runtime = await getAiRuntime();
  const { provider, client } = runtime;
  const hasVision = visionFiles.length > 0;

  if (provider === 'ollama' && hasVision) {
    const err = new Error(
      'Image/scanned file detected. Switch AI Provider to OpenAI in Settings for vision chat, or use text PDF/DOCX/TXT.'
    );
    err.code = 'OLLAMA_SCANNED_PDF';
    throw err;
  }

  let model = runtime.model;
  if (provider === 'openai' && hasVision) {
    model = pickVisionModel(model);
  }

  const temperature = Number(await db.getSetting('temperature', '0.2'));
  const maxTokens = Number(await db.getSetting('max_tokens', '2000'));
  const systemPrompt =
    (await db.getSetting('chat_system_prompt', '')) ||
    'You are a helpful AI assistant for LPDP admin. Answer clearly in the user language (Indonesian or English). If documents are attached, use them as context. If the user asks you to create/generate/draw an image, tell them to use /image <prompt> or enable Image mode. If they ask to create a PDF document, tell them to use /pdf <isi> or enable PDF mode.';

  const messages = [{ role: 'system', content: systemPrompt }];

  for (const turn of history) {
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    messages.push({
      role: turn.role,
      content: String(turn.content).slice(0, 20000),
    });
  }

  let userContent;
  const textBody = [
    textMessage,
    fileText ? `\n\n--- ATTACHED FILE CONTENT ---\n${fileText}` : '',
    hasVision
      ? '\n\nAttached file(s) may include images or scanned PDFs. Read them and answer based on their content.'
      : '',
  ]
    .join('')
    .trim();

  if (hasVision) {
    userContent = [
      { type: 'text', text: textBody },
      ...visionFiles.map((f) => fileService.toVisionContentPart(f)),
    ];
  } else {
    userContent = textBody;
  }

  messages.push({ role: 'user', content: userContent });

  const payload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  let completion;
  try {
    completion = await client.chat.completions.create(payload);
  } catch (err) {
    if (provider === 'openai' && hasVision) {
      completion = await chatWithUploadedFiles(client, {
        model,
        temperature,
        maxTokens,
        messages: messages.slice(0, -1),
        textBody,
        visionFiles,
      });
    } else {
      throw err;
    }
  }

  const reply = completion.choices?.[0]?.message?.content || '';
  return {
    reply,
    images: [],
    documents: [],
    meta: {
      provider,
      model,
      usage: completion.usage || null,
      files: visionFiles.map((f) => f.fileName),
      mode: 'chat',
    },
  };
}

async function chatWithUploadedFiles(
  client,
  { model, temperature, maxTokens, messages, textBody, visionFiles }
) {
  const uploadedIds = [];
  try {
    for (const f of visionFiles) {
      const mime = f.mime || fileService.mimeFromExt(
        path.extname(f.fileName || '').replace('.', '')
      );
      if (String(mime).startsWith('image/') || f.kind === 'image') {
        continue;
      }
      const uploaded = await client.files.create({
        file: await OpenAI.toFile(f.buffer, f.fileName || 'document.pdf', {
          type: mime || 'application/pdf',
        }),
        purpose: 'user_data',
      });
      uploadedIds.push(uploaded.id);
    }

    const imageParts = visionFiles
      .filter((f) => String(f.mime || '').startsWith('image/') || f.kind === 'image')
      .map((f) => fileService.toVisionContentPart(f));

    const content = [
      { type: 'text', text: textBody },
      ...uploadedIds.map((id) => ({
        type: 'file',
        file: { file_id: id },
      })),
      ...imageParts,
    ];

    return await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [...messages, { role: 'user', content }],
    });
  } finally {
    for (const id of uploadedIds) {
      try {
        await client.files.del(id);
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  chat,
  processChatUploads,
  wantsImageGeneration,
  wantsPdfGeneration,
  generateImage,
  generatePdf,
};
