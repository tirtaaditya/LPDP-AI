const OpenAI = require('openai');
const db = require('../db');

async function getAiRuntime() {
  const provider = String(await db.getSetting('ai_provider', 'openai'))
    .trim()
    .toLowerCase();

  if (provider === 'ollama') {
    let baseUrl = String(await db.getSetting('ollama_base_url', '')).trim().replace(/\/+$/, '');
    if (!baseUrl) {
      const err = new Error(
        'Ollama base URL is not configured. Set it in Admin → Settings'
      );
      err.code = 'OLLAMA_NOT_CONFIGURED';
      throw err;
    }
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = `${baseUrl}/v1`;
    }

    const apiKey =
      String(await db.getSetting('ollama_api_key', '')).trim() || 'ollama';
    const model =
      String(await db.getSetting('ollama_model', 'gpt-oss:latest')).trim() ||
      'gpt-oss:latest';

    return {
      provider: 'ollama',
      model,
      client: new OpenAI({
        apiKey,
        baseURL: baseUrl,
      }),
    };
  }

  const apiKey = String(await db.getSetting('openai_api_key', '')).trim();
  if (!apiKey) {
    const err = new Error(
      'OpenAI API key is not configured. Set it in Admin → Settings'
    );
    err.code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }

  const model =
    String(await db.getSetting('openai_model', 'gpt-4o-mini')).trim() ||
    'gpt-4o-mini';

  return {
    provider: 'openai',
    model,
    client: new OpenAI({ apiKey }),
  };
}

function buildTextPrompt(prompt, fileText, schemaHint, hasVisionFiles) {
  let content = String(prompt || '').trim();

  if (schemaHint) {
    content += `\n\nRequired JSON fields / schema hint:\n${schemaHint}`;
  }

  if (fileText && fileText.trim()) {
    content += `\n\n--- FILE CONTENT START ---\n${fileText.trim()}\n--- FILE CONTENT END ---`;
  }

  if (hasVisionFiles) {
    content +=
      '\n\nOne or more attached PDF files are scanned/image-based (no embedded text). Read the attached PDF file(s) carefully and extract the requested fields from them.';
  }

  content +=
    '\n\nRespond with valid JSON only. Do not wrap the response in markdown or code fences.';

  return content;
}

function normalizeResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'error', data: null, message: 'Model returned invalid JSON' };
  }

  if (parsed.status === 'success' || parsed.status === 'error') {
    return {
      status: parsed.status,
      data: parsed.data ?? null,
      message: parsed.message,
    };
  }

  return {
    status: 'success',
    data: parsed,
  };
}

function pickVisionModel(configuredModel) {
  const model = String(configuredModel || 'gpt-4o-mini');
  if (model.includes('mini') || model.includes('nano')) {
    return 'gpt-4o';
  }
  return model;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // try extract JSON object from markdown/code fence
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function extractFromPrompt({
  prompt,
  fileText = '',
  schemaHint = '',
  visionFiles = [],
}) {
  const runtime = await getAiRuntime();
  const { provider, client } = runtime;
  const hasVision = Array.isArray(visionFiles) && visionFiles.length > 0;

  if (provider === 'ollama' && hasVision) {
    const err = new Error(
      'Image/scanned file detected. Ollama cannot process vision in this app — switch AI Provider to OpenAI in Settings, or use a text-based PDF/DOCX/TXT.'
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
  const systemPrompt = await db.getSetting(
    'system_prompt',
    'You are a data extraction assistant. Always respond with valid JSON only.'
  );

  const textPrompt = buildTextPrompt(prompt, fileText, schemaHint, hasVision);

  let userContent;
  if (hasVision) {
    const fileService = require('./file.service');
    userContent = [
      { type: 'text', text: textPrompt },
      ...visionFiles.map((f) => fileService.toVisionContentPart(f)),
    ];
  } else {
    userContent = textPrompt;
  }

  const basePayload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  let completion;
  try {
    completion = await client.chat.completions.create({
      ...basePayload,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    if (provider === 'openai' && hasVision) {
      console.warn(
        'Chat file attachment failed, trying OpenAI Files API fallback:',
        err.message
      );
      try {
        completion = await extractWithUploadedFiles(client, {
          model,
          temperature,
          maxTokens,
          systemPrompt,
          textPrompt,
          visionFiles,
        });
      } catch (err2) {
        const wrapped = new Error(
          err2?.error?.message ||
            err2.message ||
            err?.error?.message ||
            err.message ||
            'OpenAI request failed'
        );
        wrapped.code = 'OPENAI_API_ERROR';
        wrapped.status = err2.status || err2.statusCode || err.status || 502;
        throw wrapped;
      }
    } else if (provider === 'ollama') {
      // Some Ollama models reject response_format
      console.warn('Ollama json_object failed, retry without response_format:', err.message);
      completion = await client.chat.completions.create(basePayload);
    } else {
      const wrapped = new Error(
        err?.error?.message || err.message || 'OpenAI request failed'
      );
      wrapped.code = 'OPENAI_API_ERROR';
      wrapped.status = err.status || err.statusCode || 502;
      wrapped.cause = err;
      throw wrapped;
    }
  }

  const raw = completion.choices?.[0]?.message?.content || '{}';
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      status: 'error',
      data: null,
      message: 'Failed to parse model JSON response',
      meta: {
        provider,
        model,
        raw,
        usage: completion.usage || null,
        vision: hasVision,
      },
    };
  }

  const normalized = normalizeResult(parsed);
  return {
    ...normalized,
    meta: {
      provider,
      model,
      raw,
      usage: completion.usage || null,
      vision: hasVision,
      vision_files: visionFiles.map((f) => f.fileName),
    },
  };
}

async function extractWithUploadedFiles(
  client,
  { model, temperature, maxTokens, systemPrompt, textPrompt, visionFiles }
) {
  const fileService = require('./file.service');
  const uploadedIds = [];
  try {
    for (const f of visionFiles) {
      const mime = f.mime || fileService.mimeFromExt(
        String(f.fileName || '').split('.').pop()
      );
      if (String(mime).startsWith('image/') || f.kind === 'image') continue;
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
      { type: 'text', text: textPrompt },
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
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });
  } finally {
    for (const id of uploadedIds) {
      try {
        await client.files.del(id);
      } catch {
        // ignore cleanup
      }
    }
  }
}

module.exports = { extractFromPrompt, getAiRuntime };
