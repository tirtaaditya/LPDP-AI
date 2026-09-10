const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const db = require('../db');
const config = require('../config');
const fileService = require('./file.service');
const { getAiRuntime } = require('./openai.service');

function pickVisionModel(configuredModel) {
  const model = String(configuredModel || 'gpt-4o-mini');
  if (model.includes('mini') || model.includes('nano')) return 'gpt-4o';
  return model;
}

function wantsImageGeneration(message, force = false) {
  if (force) return true;
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^\/(image|gambar|img)\b/i.test(text)) return true;

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

async function generateImage({ prompt, size }) {
  const runtime = await getAiRuntime();
  if (runtime.provider !== 'openai') {
    const err = new Error(
      'Image generation requires OpenAI provider. Switch AI Provider to OpenAI in Settings.'
    );
    err.code = 'IMAGE_PROVIDER_UNSUPPORTED';
    throw err;
  }

  const model =
    String(await db.getSetting('openai_image_model', 'dall-e-3')).trim() || 'dall-e-3';
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

  const payload = {
    model,
    prompt: cleanPrompt.slice(0, 3500),
    n: 1,
    size: imageSize,
    response_format: 'b64_json',
  };

  // dall-e-3 only supports n=1 and specific sizes
  if (model.includes('dall-e-3')) {
    payload.n = 1;
    if (!['1024x1024', '1024x1792', '1792x1024'].includes(imageSize)) {
      payload.size = '1024x1024';
    }
  }

  let result;
  try {
    result = await runtime.client.images.generate(payload);
  } catch (err) {
    // Some newer models may not accept response_format
    if (/response_format|unknown parameter/i.test(err.message || '')) {
      delete payload.response_format;
      result = await runtime.client.images.generate(payload);
    } else {
      throw err;
    }
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

  const saved = await saveGeneratedImage(b64, 'png');
  return {
    reply: item.revised_prompt
      ? `Gambar berhasil dibuat.\n\nPrompt (revised):\n${item.revised_prompt}`
      : 'Gambar berhasil dibuat.',
    images: [saved],
    meta: {
      provider: 'openai',
      model,
      size: payload.size,
      mode: 'image_generation',
      revised_prompt: item.revised_prompt || null,
    },
  };
}

async function chat({
  message,
  history = [],
  fileText = '',
  visionFiles = [],
  forceImage = false,
}) {
  const textMessage = String(message || '').trim();

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
    'You are a helpful AI assistant for LPDP admin. Answer clearly in the user language (Indonesian or English). If documents are attached, use them as context. If the user asks you to create/generate/draw an image, tell them to use /image <prompt> or enable Image mode.';

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
  generateImage,
};
