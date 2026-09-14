/**
 * Sync USD→IDR from LPDP API Gateway Kurs BI.
 * Docs: https://api-channellpdp.kemenkeu.go.id
 * POST /Users/authenticate → jwtToken
 * GET  /Kurs/bi?Currency=USD → kursBeli / kursJual
 */
const db = require('../db');

const DEFAULT_BASE = 'https://api-channellpdp.kemenkeu.go.id';

function pickRate(row, mode) {
  const beli = Number(String(row.kursBeli || '').replace(',', '.'));
  const jual = Number(String(row.kursJual || '').replace(',', '.'));
  const m = String(mode || 'mid').toLowerCase();
  if (m === 'beli' && Number.isFinite(beli) && beli > 0) return beli;
  if (m === 'jual' && Number.isFinite(jual) && jual > 0) return jual;
  if (Number.isFinite(beli) && Number.isFinite(jual) && beli > 0 && jual > 0) {
    return (beli + jual) / 2;
  }
  if (Number.isFinite(jual) && jual > 0) return jual;
  if (Number.isFinite(beli) && beli > 0) return beli;
  return null;
}

async function getKursConfig() {
  const settings = await db.getAllSettings();
  const email =
    String(settings.kurs_api_email || process.env.KURS_API_EMAIL || '').trim() ||
    String(settings.kurs_api_username || process.env.KURS_API_USERNAME || '').trim();
  const password =
    String(settings.kurs_api_password || process.env.KURS_API_PASSWORD || '').trim();
  return {
    enabled: String(settings.kurs_auto_enabled || 'false').toLowerCase() === 'true',
    baseUrl: String(
      settings.kurs_api_base_url || process.env.KURS_API_BASE_URL || DEFAULT_BASE
    )
      .trim()
      .replace(/\/$/, ''),
    email,
    password,
    rateMode: String(settings.kurs_rate_mode || 'mid').toLowerCase(),
    hour: Math.min(23, Math.max(0, Number(settings.kurs_schedule_hour || 10) || 10)),
  };
}

async function authenticate(baseUrl, email, password) {
  const url = `${baseUrl}/Users/authenticate`;
  const bodies = [
    { email, password },
    { Email: email, Password: password },
    { username: email, password },
    { Username: email, Password: password },
  ];

  let lastErr = null;
  for (const body of bodies) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      const token =
        json?.jwtToken ||
        json?.JwtToken ||
        json?.token ||
        json?.access_token ||
        json?.data?.jwtToken;
      if (res.ok && token) {
        return String(token);
      }
      lastErr = new Error(
        `Authenticate HTTP ${res.status}: ${String(text).slice(0, 200)}`
      );
      // 400/401 with wrong shape → try next body
      if (res.status >= 500) break;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Authenticate failed');
}

async function fetchUsdKurs(baseUrl, jwtToken) {
  const url = `${baseUrl}/Kurs/bi?Currency=USD`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Kurs response not JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Kurs HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const ok = json.Status === true || json.status === true || json.Status === 'true';
  const data = json.Data || json.data || [];
  if (!ok || !Array.isArray(data) || !data.length) {
    throw new Error(`Kurs empty/invalid: ${text.slice(0, 200)}`);
  }
  const row =
    data.find((d) => String(d.mataUang || d.MataUang || '').toUpperCase() === 'USD') ||
    data[0];
  return row;
}

/**
 * Pull BI USD rate and update dbo.settings usd_to_idr.
 * @param {{ force?: boolean }} opts
 */
async function syncUsdToIdr(opts = {}) {
  const cfg = await getKursConfig();
  if (!opts.force && !cfg.enabled) {
    return { skipped: true, reason: 'kurs_auto_enabled=false' };
  }
  if (!cfg.email || !cfg.password) {
    const err = new Error(
      'Kurs API credentials missing. Set kurs_api_email + kurs_api_password in Settings (or KURS_API_* in .env).'
    );
    err.code = 'KURS_CREDENTIALS_MISSING';
    throw err;
  }

  const token = await authenticate(cfg.baseUrl, cfg.email, cfg.password);
  const row = await fetchUsdKurs(cfg.baseUrl, token);
  const rate = pickRate(row, cfg.rateMode);
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Could not parse kursBeli/kursJual from API');
  }

  const rounded = Math.round(rate * 100) / 100;
  await db.setSetting('usd_to_idr', String(rounded));
  await db.setSetting('kurs_last_value', String(rounded));
  await db.setSetting('kurs_last_sync_at', new Date().toISOString());
  await db.setSetting('kurs_last_error', '');
  await db.setSetting(
    'kurs_last_raw',
    JSON.stringify({
      mataUang: row.mataUang || row.MataUang,
      kursBeli: row.kursBeli || row.KursBeli,
      kursJual: row.kursJual || row.KursJual,
      createdOn: row.createdOn || row.CreatedOn,
      mode: cfg.rateMode,
    }).slice(0, 2000)
  );

  console.log(
    `[kurs] Updated usd_to_idr=${rounded} (mode=${cfg.rateMode}, beli=${row.kursBeli}, jual=${row.kursJual})`
  );

  return {
    skipped: false,
    usdToIdr: rounded,
    mode: cfg.rateMode,
    raw: row,
  };
}

module.exports = {
  DEFAULT_BASE,
  getKursConfig,
  syncUsdToIdr,
  pickRate,
};
