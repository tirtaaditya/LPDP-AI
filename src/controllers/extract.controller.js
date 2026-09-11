const openaiService = require('../services/openai.service');
const fileService = require('../services/file.service');
const db = require('../db');
const { failure } = require('../utils/response');

function authMeta(req) {
  const auth = req.auth || {};
  if (auth.type === 'static' && auth.token) {
    return {
      userId: auth.userId,
      username: auth.username,
      authType: 'static',
      tokenId: auth.token.id,
      tokenName: auth.token.name,
      tokenPrefix: auth.token.token_prefix,
    };
  }
  return {
    userId: auth.userId || null,
    username: auth.username || null,
    authType: auth.type || 'jwt',
    tokenId: null,
    tokenName: null,
    tokenPrefix: null,
  };
}

async function saveLog(payload) {
  try {
    await db.createExtractLog(payload);
  } catch (err) {
    console.error('Failed to save extract log:', err.message);
    console.error('Log payload keys:', {
      hasFile: payload.hasFile,
      fileNameLen: payload.fileName ? String(payload.fileName).length : 0,
      fileTextLen: payload.fileText ? String(payload.fileText).length : 0,
    });
  }
}

function cleanupUploads(files) {
  for (const f of files || []) {
    try {
      fileService.safeUnlink(f.path);
    } catch {
      // ignore
    }
  }
}

async function extract(req, res) {
  const started = Date.now();
  const prompt = req.body?.prompt;
  const schemaHint = req.body?.schema_hint || '';
  const auth = authMeta(req);
  const ip = req.clientIp || req.ip;
  const fileUrls = fileService.parseFileUrls(req.body || {});
  const uploads = Array.isArray(req.files) ? req.files : [];

  if (!prompt || !String(prompt).trim()) {
    cleanupUploads(uploads);
    await saveLog({
      requestId: req.requestId,
      ...auth,
      prompt: prompt || '',
      schemaHint,
      hasFile: fileUrls.length > 0 || uploads.length > 0,
      fileName: fileUrls.length ? fileUrls.join(' | ') : null,
      fileSize: null,
      fileText: null,
      aiResponse: null,
      responseStatus: 'error',
      httpStatus: 400,
      ip,
      durationMs: Date.now() - started,
      errorMessage: 'prompt is required',
    });
    return failure(res, 'prompt is required', 400);
  }

  let fileMeta = {
    hasFile: false,
    fileName: null,
    fileSize: null,
    fileText: '',
    files: [],
    visionFiles: [],
  };

  try {
    if (fileUrls.length + uploads.length > fileService.MAX_FILES) {
      const err = new Error(
        `Too many files (file_urls + file_uploads). Max ${fileService.MAX_FILES} files per request`
      );
      err.code = 'FILE_TOO_MANY';
      throw err;
    }

    const [urlMeta, uploadMeta] = await Promise.all([
      fileUrls.length
        ? fileService.downloadAndExtractMany(fileUrls)
        : Promise.resolve(null),
      uploads.length
        ? fileService.processMulterUploads(uploads)
        : Promise.resolve(null),
    ]);

    fileMeta = fileService.mergeFileMeta(urlMeta, uploadMeta);

    const result = await openaiService.extractFromPrompt({
      prompt,
      fileText: fileMeta.fileText,
      schemaHint,
      visionFiles: fileMeta.visionFiles || [],
    });

    const durationMs = Date.now() - started;
    const usage = result.meta?.usage || {};
    const aiResponse =
      result.meta?.raw ||
      JSON.stringify({ status: result.status, data: result.data, message: result.message });

    const logBase = {
      requestId: req.requestId,
      ...auth,
      prompt,
      schemaHint,
      hasFile: fileMeta.hasFile,
      fileName: fileMeta.hasFile
        ? JSON.stringify({
            urls: fileUrls,
            uploads: (fileMeta.files || []).filter((f) => f.source === 'upload'),
            files: fileMeta.files,
          })
        : null,
      fileSize: fileMeta.fileSize,
      fileText: fileMeta.fileText,
      aiResponse,
      model: result.meta?.model || null,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      ip,
      durationMs,
    };

    if (result.status === 'error') {
      await saveLog({
        ...logBase,
        responseStatus: 'error',
        httpStatus: 502,
        errorMessage: result.message || 'Extraction failed',
      });
      return failure(res, result.message || 'Extraction failed', 502, result.data);
    }

    await saveLog({
      ...logBase,
      responseStatus: 'success',
      httpStatus: 200,
      errorMessage: null,
    });

    return res.status(200).json({
      status: 'success',
      data: result.data,
      meta: {
        model: result.meta?.model,
        usage: result.meta?.usage || null,
        request_id: req.requestId,
        files: fileMeta.files,
      },
    });
  } catch (err) {
    cleanupUploads(uploads);

    let httpStatus = 502;
    if (err.code === 'OPENAI_NOT_CONFIGURED') httpStatus = 503;
    if (err.code === 'OLLAMA_NOT_CONFIGURED' || err.code === 'OLLAMA_SCANNED_PDF') httpStatus = 400;
    if (err.code === 'OPENAI_API_ERROR' && err.status && err.status >= 400 && err.status < 500) {
      httpStatus = err.status;
    }
    if (
      [
        'FILE_TYPE_NOT_ALLOWED',
        'FILE_TOO_LARGE',
        'FILE_EMPTY',
        'FILE_URL_INVALID',
        'FILE_DOWNLOAD_FAILED',
        'FILE_TOO_MANY',
        'LIMIT_FILE_SIZE',
        'LIMIT_FILE_COUNT',
        'LIMIT_UNEXPECTED_FILE',
      ].includes(err.code)
    ) {
      httpStatus = 400;
    }

    await saveLog({
      requestId: req.requestId,
      ...auth,
      prompt,
      schemaHint,
      hasFile: fileUrls.length > 0 || uploads.length > 0,
      fileName:
        fileUrls.length || uploads.length
          ? JSON.stringify({
              urls: fileUrls,
              uploads: uploads.map((f) => ({
                file_name: f.originalname,
                file_size: f.size,
              })),
              files: fileMeta.files,
            })
          : null,
      fileSize: fileMeta.fileSize,
      fileText: fileMeta.fileText || null,
      aiResponse: null,
      responseStatus: 'error',
      httpStatus,
      ip,
      durationMs: Date.now() - started,
      errorMessage: err.message || 'OpenAI request failed',
    });

    console.error('Extract error:', err);
    const { safeClientMessage } = require('../utils/safeError');
    if (!err.code && (err.status || err.statusCode || err.error?.message)) {
      err.code = 'OPENAI_API_ERROR';
    }
    const clientMsg = safeClientMessage(
      { ...err, status: httpStatus },
      httpStatus >= 500 ? 'AI request failed' : err.message || 'Request failed'
    );
    return failure(res, clientMsg, httpStatus, {
      request_id: req.requestId || null,
      error_code: err.code || null,
    });
  }
}

module.exports = { extract };
