const crypto = require('crypto');
const config = require('../config');

const CAPTCHA_COOKIE = 'login_captcha';
const CAPTCHA_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 5;

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.adminSessionSecret)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function unsignPayload(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', config.adminSessionSecret)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function randomDigits(length = CODE_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String(crypto.randomInt(0, 10));
  }
  return out;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Distorted SVG captcha (numbers only). */
function renderCaptchaSvg(code) {
  const width = 180;
  const height = 56;
  const chars = String(code).split('');
  const noise = [];
  for (let i = 0; i < 8; i++) {
    const x1 = crypto.randomInt(0, width);
    const y1 = crypto.randomInt(0, height);
    const x2 = crypto.randomInt(0, width);
    const y2 = crypto.randomInt(0, height);
    noise.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(8,145,178,0.35)" stroke-width="1"/>`
    );
  }
  for (let i = 0; i < 18; i++) {
    noise.push(
      `<circle cx="${crypto.randomInt(0, width)}" cy="${crypto.randomInt(0, height)}" r="1" fill="rgba(15,23,42,0.25)"/>`
    );
  }

  const letters = chars
    .map((ch, i) => {
      const x = 22 + i * 32;
      const y = 34 + crypto.randomInt(-4, 5);
      const rot = crypto.randomInt(-18, 19);
      const size = 26 + crypto.randomInt(0, 5);
      return `<text x="${x}" y="${y}" fill="#0f172a" font-size="${size}" font-family="JetBrains Mono, Consolas, monospace" font-weight="700" transform="rotate(${rot} ${x} ${y})">${escapeXml(ch)}</text>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Captcha">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ecfeff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="10" fill="url(#g)" stroke="#94a3b8"/>
  ${noise.join('\n  ')}
  ${letters}
</svg>`;
}

/** Map digit → frequency (Hz) for audio playback. */
const DIGIT_FREQ = {
  0: 440,
  1: 494,
  2: 523,
  3: 587,
  4: 659,
  5: 698,
  6: 784,
  7: 880,
  8: 988,
  9: 1047,
};

function renderCaptchaWav(code) {
  const sampleRate = 22050;
  const digitMs = 320;
  const gapMs = 120;
  const samples = [];

  function pushTone(freq, ms, volume = 0.35) {
    const n = Math.floor((sampleRate * ms) / 1000);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, i / 400) * Math.min(1, (n - i) / 600);
      const sample = Math.sin(2 * Math.PI * freq * t) * volume * env;
      samples.push(sample);
    }
  }

  function pushSilence(ms) {
    const n = Math.floor((sampleRate * ms) / 1000);
    for (let i = 0; i < n; i++) samples.push(0);
  }

  pushSilence(80);
  for (const ch of String(code)) {
    const freq = DIGIT_FREQ[ch] || 440;
    pushTone(freq, digitMs);
    pushSilence(gapMs);
  }
  pushSilence(80);

  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.floor(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

function createCaptcha() {
  const code = randomDigits(CODE_LENGTH);
  const payload = {
    code,
    exp: Date.now() + CAPTCHA_TTL_MS,
  };
  return {
    code,
    token: signPayload(payload),
    svg: renderCaptchaSvg(code),
    wav: renderCaptchaWav(code),
  };
}

function readCaptcha(token) {
  const payload = unsignPayload(token);
  if (!payload || !payload.code || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;
  return payload;
}

function verifyCaptcha(token, input) {
  const payload = readCaptcha(token);
  if (!payload) return false;
  const expected = String(payload.code);
  const got = String(input || '')
    .replace(/\s+/g, '')
    .trim();
  if (got.length !== expected.length) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function captchaCookieOptions(req) {
  const { cookieSecureForRequest } = require('./requestScheme');
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecureForRequest(req),
    path: '/admin',
    maxAge: CAPTCHA_TTL_MS,
  };
}

module.exports = {
  CAPTCHA_COOKIE,
  createCaptcha,
  readCaptcha,
  verifyCaptcha,
  captchaCookieOptions,
  renderCaptchaSvg,
  renderCaptchaWav,
};
