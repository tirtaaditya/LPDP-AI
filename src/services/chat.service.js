const path = require('path');
const OpenAI = require('openai');
const db = require('../db');
const fileService = require('./file.service');
const { getAiRuntime } = require('./openai.service');

function pickVisionModel(configuredModel) {
  const model = String(configuredModel || 'gpt-4o-mini');
  if (model.includes('mini') || model.includes('nano')) return 'gpt-4o';
  return model;
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
          fileName: file.originalname || 'document.pdf',
          mime: 'application/pdf',
          buffer: extracted.buffer || buffer,
        });
        textParts.push(
          `--- FILE (scanned PDF): ${file.originalname} ---\n[Attached for AI vision reading]`
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

async function chat({ message, history = [], fileText = '', visionFiles = [] }) {
  const runtime = await getAiRuntime();
  const { provider, client } = runtime;
  const hasVision = visionFiles.length > 0;

  if (provider === 'ollama' && hasVision) {
    const err = new Error(
      'Scanned PDF detected. Switch AI Provider to OpenAI in Settings for vision chat, or use a text PDF/DOCX/TXT.'
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
    'You are a helpful AI assistant for LPDP admin. Answer clearly in the user language (Indonesian or English). If documents are attached, use them as context.';

  const messages = [{ role: 'system', content: systemPrompt }];

  // prior turns (text only from client)
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
    String(message || '').trim(),
    fileText ? `\n\n--- ATTACHED FILE CONTENT ---\n${fileText}` : '',
    hasVision
      ? '\n\nAttached PDF(s) are scanned. Read them and answer based on their content.'
      : '',
  ]
    .join('')
    .trim();

  if (hasVision) {
    userContent = [
      { type: 'text', text: textBody },
      ...visionFiles.map((f) => ({
        type: 'file',
        file: {
          filename: f.fileName || 'document.pdf',
          file_data: `data:application/pdf;base64,${f.buffer.toString('base64')}`,
        },
      })),
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
    meta: {
      provider,
      model,
      usage: completion.usage || null,
      files: visionFiles.map((f) => f.fileName),
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
      const uploaded = await client.files.create({
        file: await OpenAI.toFile(f.buffer, f.fileName || 'document.pdf', {
          type: 'application/pdf',
        }),
        purpose: 'user_data',
      });
      uploadedIds.push(uploaded.id);
    }

    const content = [
      { type: 'text', text: textBody },
      ...uploadedIds.map((id) => ({
        type: 'file',
        file: { file_id: id },
      })),
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

module.exports = { chat, processChatUploads };
