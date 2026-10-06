/** Max character length per admin form field (used by views + server validation) */
const INPUT_LIMITS = {
  // auth / users
  username: 100,
  password: 128,
  current_password: 128,
  new_password: 128,
  confirm_password: 128,
  captcha: 5,
  role: 20,
  is_active: 5,

  // whitelist / tokens
  user_id: 20,
  ip: 64,
  label: 200,
  name: 200,

  // settings
  openai_api_key: 300,
  openai_model: 100,
  openai_image_model: 100,
  openai_image_size: 20,
  openai_price_prompt_per_1m_usd: 20,
  openai_price_completion_per_1m_usd: 20,
  usd_to_idr: 20,
  openai_image_price_usd: 20,
  kurs_auto_enabled: 5,
  kurs_schedule_hour: 2,
  kurs_rate_mode: 10,
  kurs_api_base_url: 500,
  kurs_api_email: 200,
  kurs_api_password: 200,
  temperature: 10,
  max_tokens: 10,
  max_upload_mb: 10,
  allowed_file_types: 200,
  system_prompt: 1000,
  ip_whitelist_enabled: 5,
  extract_cache_enabled: 5,
  extract_cache_ttl_sec: 10,
  daily_cost_budget_usd: 20,

  // chat
  message: 4000,
};

const INPUT_LABELS = {
  system_prompt: 'System prompt',
  message: 'Pesan chat',
  username: 'Username',
  password: 'Password',
  new_password: 'Password baru',
  confirm_password: 'Konfirmasi password',
  current_password: 'Password saat ini',
  ip: 'IP',
  label: 'Label',
  name: 'Nama token',
};

function labelFor(field) {
  return INPUT_LABELS[field] || field;
}

/** Returns an error message for the first field over its limit, or null */
function findLengthViolation(body) {
  if (!body || typeof body !== 'object') return null;
  for (const [field, max] of Object.entries(INPUT_LIMITS)) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (String(v).length > max) {
        return `${labelFor(field)} maksimal ${max} karakter`;
      }
    }
  }
  return null;
}

module.exports = { INPUT_LIMITS, findLengthViolation };
