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
    if (parsed && (parsed.title || parsed.body)) {
      return {
        title: String(parsed.title || 'Dokumen AI LPDP').trim(),
        body: String(parsed.body || '').trim(),
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
  return { title, body: body || text };
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

function buildPdfBuffer({ title, body }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: title,
        Author: 'AI LPDP Admin Chat',
        Creator: 'AI LPDP',
      },
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
    const safeBody = String(body || '').slice(0, 80000);

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
        `Dibuat: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
        { align: 'left' }
      );
    doc.moveDown(1);
    doc.fillColor('#1e293b').fontSize(11).text(safeBody || '(kosong)', {
      align: 'left',
      lineGap: 3,
    });

    doc.end();
  });
}

async function generatePdf({ prompt, history = [], fileText = '' }) {
  const runtime = await getAiRuntime();
  const { provider, client, model } = runtime;
  const topic = cleanPdfPrompt(prompt) || String(prompt || '').trim();
  if (!topic && !fileText) {
    const err = new Error(
      'PDF prompt is too short. Describe the document, or use /pdf <isi dokumen>.'
    );
    err.code = 'PDF_PROMPT_SHORT';
    throw err;
  }

  const temperature = Number(await db.getSetting('temperature', '0.2'));
  const maxTokens = Math.min(
    4000,
    Math.max(800, Number(await db.getSetting('max_tokens', '2000')) || 2000)
  );

  const systemPrompt =
    'You are a document writer for LPDP admin. Write clear Indonesian documents. ' +
    'Return ONLY valid JSON (no markdown fences) with keys: "title" (short) and "body" (full document text, paragraphs separated by blank lines). ' +
    'Do not invent confidential personal data. If context files are attached, use them.';

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const turn of history.slice(-8)) {
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    messages.push({
      role: turn.role,
      content: String(turn.content).slice(0, 8000),
    });
  }
  messages.push({
    role: 'user',
    content: [
      `Buatkan dokumen PDF dengan topik/instruksi berikut:\n${topic || '(lihat lampiran)'}`,
      fileText
        ? `\n\n--- KONTEKS FILE ---\n${String(fileText).slice(0, 30000)}`
        : '',
    ]
      .join('')
      .trim(),
  });

  const completion = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  });

  const raw = completion.choices?.[0]?.message?.content || '';
  const { title, body } = parsePdfDocumentJson(raw);
  if (!body) {
    const err = new Error('AI did not return document body for PDF.');
    err.code = 'PDF_EMPTY_BODY';
    throw err;
  }

  const pdfBuffer = await buildPdfBuffer({ title, body });
  const saved = await saveGeneratedPdfBuffer(pdfBuffer);

  return {
    reply: `PDF berhasil dibuat.\n\nJudul: ${title}\n\nUnduh file di bawah, atau buka di tab baru.`,
    images: [],
    documents: [saved],
    meta: {
      provider,
      model,
      usage: completion.usage || null,
      mode: 'pdf_generation',
      title,
    },
  };
}

/**
 * Process multer files into text + optional vision PDF buffers.
 */
async function processChatUploads(files = []) {
  const textParts = [];
  const visionFiles = [];
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
  forceImage = false,
  forcePdf = false,
}) {
  const textMessage = String(message || '').trim();

  if (wantsPdfGeneration(textMessage, forcePdf)) {
    return generatePdf({
      prompt: textMessage,
      history,
      fileText,
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
