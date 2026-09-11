const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const db = require('../db');
const config = require('../config');

const MAX_FILES = 10;
const DOWNLOAD_TIMEOUT_MS = 60000;
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

function formatMb(bytes) {
  return (Number(bytes) / (1024 * 1024)).toFixed(2);
}

function isImageExt(ext) {
  return IMAGE_EXTS.has(String(ext || '').toLowerCase());
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[e] || 'application/octet-stream';
}

function normalizeAllowedTypes(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
}

async function getAllowedExtensions() {
  const raw = await db.getSetting('allowed_file_types', 'pdf,docx,txt');
  const list = normalizeAllowedTypes(raw);
  return list.length ? list : ['pdf', 'docx', 'txt'];
}

async function getMaxUploadBytes() {
  const mb = Number(await db.getSetting('max_upload_mb', '10'));
  return mb * 1024 * 1024;
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function assertHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    const err = new Error(`Invalid file URL: ${rawUrl}`);
    err.code = 'FILE_URL_INVALID';
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error(`Only http/https file URLs are allowed: ${rawUrl}`);
    err.code = 'FILE_URL_INVALID';
    throw err;
  }
  return parsed;
}

function guessExtension(urlObj, contentType, contentDisposition) {
  const fromPath = path.extname(urlObj.pathname || '').replace('.', '').toLowerCase();
  if (fromPath) return fromPath;

  if (contentDisposition) {
    const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(contentDisposition);
    if (star?.[1]) {
      try {
        const name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
        const ext = path.extname(name).replace('.', '').toLowerCase();
        if (ext) return ext;
      } catch {
        // ignore
      }
    }
    const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(contentDisposition);
    if (plain) {
      const name = String(plain[1] || plain[2] || '')
        .trim()
        .replace(/^"|"$/g, '');
      const ext = path.extname(name).replace('.', '').toLowerCase();
      if (ext) return ext;
    }
  }

  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('wordprocessingml') || ct.includes('msword')) return 'docx';
  if (ct.includes('text/plain')) return 'txt';
  if (ct.includes('jpeg')) return 'jpeg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.startsWith('image/')) return ct.split('/')[1] || 'jpg';
  return '';
}

/**
 * @returns {{ text: string, needsVision: boolean, buffer?: Buffer }}
 */
async function extractTextFromBuffer(buffer, ext, label = 'file') {
  const allowed = await getAllowedExtensions();
  if (!allowed.includes(ext)) {
    const err = new Error(
      `File type .${ext || '?'} not allowed for ${label}. Allowed: ${allowed.join(', ')}`
    );
    err.code = 'FILE_TYPE_NOT_ALLOWED';
    throw err;
  }

  const maxBytes = await getMaxUploadBytes();
  if (buffer.length > maxBytes) {
    const err = new Error(
      `File too large (${label}). Max ${maxBytes / (1024 * 1024)} MB`
    );
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  if (ext === 'txt') {
    const text = buffer.toString('utf8').trim();
    if (!text) {
      const err = new Error(`Text file is empty: ${label}`);
      err.code = 'FILE_EMPTY';
      throw err;
    }
    return { text, needsVision: false };
  }

  if (ext === 'pdf') {
    const result = await pdfParse(buffer);
    const text = (result.text || '').trim();
    if (!text) {
      // Scanned / image-only PDF → send to OpenAI file/vision mode
      return { text: '', needsVision: true, buffer, mime: 'application/pdf', kind: 'pdf' };
    }
    return { text, needsVision: false, mime: 'application/pdf', kind: 'pdf' };
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    if (!text) {
      const err = new Error(`DOCX has no extractable text: ${label}`);
      err.code = 'FILE_EMPTY';
      throw err;
    }
    return { text, needsVision: false, mime: mimeFromExt(ext), kind: 'docx' };
  }

  if (isImageExt(ext)) {
    return {
      text: '',
      needsVision: true,
      buffer,
      mime: mimeFromExt(ext),
      kind: 'image',
    };
  }

  const err = new Error(`Unsupported file type .${ext}: ${label}`);
  err.code = 'FILE_TYPE_NOT_ALLOWED';
  throw err;
}

async function downloadOne(urlString) {
  const urlObj = assertHttpUrl(urlString);
  const maxBytes = await getMaxUploadBytes();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-LPDP-FileFetcher/1.0',
      },
    });

    if (!response.ok) {
      const err = new Error(`Failed to download file (${response.status}): ${urlString}`);
      err.code = 'FILE_DOWNLOAD_FAILED';
      throw err;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > maxBytes) {
      const err = new Error(
        `Remote file too large (${formatMb(contentLength)} MB > limit ${formatMb(maxBytes)} MB). Raise Max upload (MB) in Admin → Settings. URL: ${urlString}`
      );
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxBytes) {
      const err = new Error(
        `Remote file too large (${formatMb(buffer.length)} MB > limit ${formatMb(maxBytes)} MB). Raise Max upload (MB) in Admin → Settings. URL: ${urlString}`
      );
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }

    const ext = guessExtension(
      urlObj,
      response.headers.get('content-type'),
      response.headers.get('content-disposition')
    );
    const fileName =
      path.basename(urlObj.pathname) || `download.${ext || 'bin'}`;

    const extracted = await extractTextFromBuffer(buffer, ext, fileName);

    return {
      url: urlObj.toString(),
      fileName,
      fileSize: buffer.length,
      ext,
      text: extracted.text,
      needsVision: extracted.needsVision,
      mime: extracted.mime || mimeFromExt(ext),
      buffer: extracted.needsVision ? buffer : null,
    };
  } catch (err) {
    if (err.code) throw err;
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Download timeout: ${urlString}`);
      timeoutErr.code = 'FILE_DOWNLOAD_FAILED';
      throw timeoutErr;
    }
    const wrap = new Error(
      `Failed to download file: ${err.message || 'network error'} (${urlString})`
    );
    wrap.code = 'FILE_DOWNLOAD_FAILED';
    throw wrap;
  } finally {
    clearTimeout(timer);
  }
}

function parseFileUrls(body = {}) {
  const urls = [];

  if (Array.isArray(body.file_urls)) {
    urls.push(...body.file_urls);
  } else if (typeof body.file_urls === 'string' && body.file_urls.trim()) {
    const raw = body.file_urls.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) urls.push(...parsed);
      } catch {
        urls.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
      }
    } else {
      urls.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
    }
  }

  if (body.file_url) {
    if (Array.isArray(body.file_url)) urls.push(...body.file_url);
    else urls.push(String(body.file_url));
  }

  return [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
}

async function downloadAndExtractMany(urls) {
  if (!urls.length) {
    return {
      hasFile: false,
      fileName: null,
      fileSize: null,
      fileText: '',
      files: [],
      visionFiles: [],
    };
  }

  if (urls.length > MAX_FILES) {
    const err = new Error(`Too many file_urls. Max ${MAX_FILES} files per request`);
    err.code = 'FILE_TOO_MANY';
    throw err;
  }

  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }

  const files = [];
  for (const url of urls) {
    files.push(await downloadOne(url));
  }

  const textParts = files
    .filter((f) => f.text)
    .map(
      (f, i) =>
        `--- FILE ${i + 1}: ${f.fileName} ---\nURL: ${f.url}\n\n${f.text}`
    );

  const visionNotes = files
    .filter((f) => f.needsVision)
    .map((f) => {
      const kind = isImageExt(f.ext) ? 'image' : 'scanned PDF';
      return `--- FILE (${kind}, sent to AI vision): ${f.fileName} ---\nURL: ${f.url}`;
    });

  const combinedText = [...textParts, ...visionNotes].join('\n\n');

  const visionFiles = files
    .filter((f) => f.needsVision && f.buffer)
    .map((f) => ({
      fileName: f.fileName,
      mime: f.mime || mimeFromExt(f.ext),
      buffer: f.buffer,
      url: f.url,
      kind: isImageExt(f.ext) ? 'image' : 'pdf',
    }));

  return {
    hasFile: true,
    fileName: files.map((f) => f.fileName).join(', '),
    fileSize: files.reduce((sum, f) => sum + f.fileSize, 0),
    fileText:
      combinedText ||
      (visionFiles.length ? '[Image/scanned file(s) — processed via OpenAI vision]' : ''),
    files: files.map((f) => ({
      url: f.url,
      file_name: f.fileName,
      file_size: f.fileSize,
      ext: f.ext,
      scanned: Boolean(f.needsVision),
      source: f.source || 'url',
    })),
    visionFiles,
  };
}

/**
 * Process multipart uploads (multer files) — field name: file_uploads
 */
async function processMulterUploads(multerFiles = []) {
  const list = Array.isArray(multerFiles) ? multerFiles : [];
  if (!list.length) {
    return {
      hasFile: false,
      fileName: null,
      fileSize: null,
      fileText: '',
      files: [],
      visionFiles: [],
    };
  }

  if (list.length > MAX_FILES) {
    for (const f of list) safeUnlink(f.path);
    const err = new Error(`Too many file_uploads. Max ${MAX_FILES} files per request`);
    err.code = 'FILE_TOO_MANY';
    throw err;
  }

  const files = [];
  try {
    for (const file of list) {
      const original = file.originalname || 'upload.bin';
      const ext = path.extname(original).replace('.', '').toLowerCase();
      const buffer = fs.readFileSync(file.path);
      const extracted = await extractTextFromBuffer(buffer, ext, original);
      files.push({
        url: null,
        fileName: original,
        fileSize: buffer.length,
        ext,
        text: extracted.text,
        needsVision: extracted.needsVision,
        mime: extracted.mime || mimeFromExt(ext) || file.mimetype,
        buffer: extracted.needsVision ? buffer : null,
        source: 'upload',
      });
    }
  } finally {
    for (const f of list) safeUnlink(f.path);
  }

  const textParts = files
    .filter((f) => f.text)
    .map(
      (f, i) =>
        `--- FILE ${i + 1} (upload): ${f.fileName} ---\n\n${f.text}`
    );

  const visionNotes = files
    .filter((f) => f.needsVision)
    .map((f) => {
      const kind = isImageExt(f.ext) ? 'image' : 'scanned PDF';
      return `--- FILE (${kind}, upload, sent to AI vision): ${f.fileName} ---`;
    });

  const combinedText = [...textParts, ...visionNotes].join('\n\n');
  const visionFiles = files
    .filter((f) => f.needsVision && f.buffer)
    .map((f) => ({
      fileName: f.fileName,
      mime: f.mime || mimeFromExt(f.ext),
      buffer: f.buffer,
      url: null,
      kind: isImageExt(f.ext) ? 'image' : 'pdf',
    }));

  return {
    hasFile: true,
    fileName: files.map((f) => f.fileName).join(', '),
    fileSize: files.reduce((sum, f) => sum + f.fileSize, 0),
    fileText:
      combinedText ||
      (visionFiles.length ? '[Image/scanned file(s) — processed via OpenAI vision]' : ''),
    files: files.map((f) => ({
      url: null,
      file_name: f.fileName,
      file_size: f.fileSize,
      ext: f.ext,
      scanned: Boolean(f.needsVision),
      source: 'upload',
    })),
    visionFiles,
  };
}

/** Merge URL downloads + multipart uploads (max MAX_FILES total). */
function mergeFileMeta(a, b) {
  const empty = {
    hasFile: false,
    fileName: null,
    fileSize: null,
    fileText: '',
    files: [],
    visionFiles: [],
  };
  const left = a || empty;
  const right = b || empty;
  const files = [...(left.files || []), ...(right.files || [])];
  if (files.length > MAX_FILES) {
    const err = new Error(
      `Too many files (file_urls + file_uploads). Max ${MAX_FILES} files per request`
    );
    err.code = 'FILE_TOO_MANY';
    throw err;
  }
  if (!files.length) return empty;

  const textParts = [left.fileText, right.fileText].filter((t) => String(t || '').trim());
  const visionFiles = [...(left.visionFiles || []), ...(right.visionFiles || [])];

  return {
    hasFile: true,
    fileName: files.map((f) => f.file_name).filter(Boolean).join(', '),
    fileSize: files.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0),
    fileText: textParts.join('\n\n'),
    files,
    visionFiles,
  };
}

function toVisionContentPart(f) {
  const mime = f.mime || mimeFromExt(path.extname(f.fileName || '').replace('.', ''));
  const b64 = f.buffer.toString('base64');
  if (String(mime).startsWith('image/') || f.kind === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${b64}` },
    };
  }
  return {
    type: 'file',
    file: {
      filename: f.fileName || 'document.pdf',
      file_data: `data:${mime || 'application/pdf'};base64,${b64}`,
    },
  };
}

module.exports = {
  getAllowedExtensions,
  getMaxUploadBytes,
  safeUnlink,
  parseFileUrls,
  downloadAndExtractMany,
  processMulterUploads,
  mergeFileMeta,
  extractTextFromBuffer,
  normalizeAllowedTypes,
  mimeFromExt,
  isImageExt,
  toVisionContentPart,
  MAX_FILES,
};
