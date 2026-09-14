const db = require('../db');

/**
 * Built-in OpenAI list prices (USD per 1M tokens).
 * Source: OpenAI public pricing (input / output). Not live-fetched —
 * OpenAI does not expose an official rate-card API for apps.
 * Update this catalog when OpenAI changes list prices.
 */
const MODEL_PRICES = {
  'gpt-4o-mini': { promptPer1mUsd: 0.15, completionPer1mUsd: 0.6 },
  'gpt-4o': { promptPer1mUsd: 2.5, completionPer1mUsd: 10.0 },
  'gpt-4.1-mini': { promptPer1mUsd: 0.4, completionPer1mUsd: 1.6 },
  'gpt-4.1': { promptPer1mUsd: 2.0, completionPer1mUsd: 8.0 },
  'gpt-4.1-nano': { promptPer1mUsd: 0.1, completionPer1mUsd: 0.4 },
  'o3-mini': { promptPer1mUsd: 1.1, completionPer1mUsd: 4.4 },
  'o1-mini': { promptPer1mUsd: 1.1, completionPer1mUsd: 4.4 },
  'gpt-3.5-turbo': { promptPer1mUsd: 0.5, completionPer1mUsd: 1.5 },
};

const DEFAULTS = {
  promptPer1mUsd: 0.15,
  completionPer1mUsd: 0.6,
  usdToIdr: 16000,
  imageUsd: 0.04,
};

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeModelKey(model) {
  return String(model || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');
}

/**
 * Match exact model id, then prefix (e.g. gpt-4o-mini-2024-07-18 → gpt-4o-mini).
 * Prefer longer keys first so gpt-4o-mini wins over gpt-4o.
 */
function lookupModelPrices(model) {
  const key = normalizeModelKey(model);
  if (!key) return null;
  if (MODEL_PRICES[key]) return MODEL_PRICES[key];

  const keys = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (key === k || key.startsWith(`${k}-`) || key.startsWith(`${k}_`)) {
      return MODEL_PRICES[k];
    }
  }
  // gpt-4o vs gpt-4o-mini already handled by longer-first; avoid gpt-4o matching mini reverse
  return null;
}

async function getTokenPricing() {
  const settings = await db.getAllSettings();
  return {
    promptPer1mUsd: toNumber(
      settings.openai_price_prompt_per_1m_usd,
      DEFAULTS.promptPer1mUsd
    ),
    completionPer1mUsd: toNumber(
      settings.openai_price_completion_per_1m_usd,
      DEFAULTS.completionPer1mUsd
    ),
    usdToIdr: toNumber(settings.usd_to_idr, DEFAULTS.usdToIdr),
    imageUsd: toNumber(settings.openai_image_price_usd, DEFAULTS.imageUsd),
    modelCatalog: MODEL_PRICES,
  };
}

/**
 * Resolve rates for a specific model.
 * 1) Built-in catalog by model name
 * 2) Else Settings fallback (openai_price_* ) — used for unknown / Ollama models
 */
function resolveRatesForModel(model, pricing = DEFAULTS) {
  const catalog = lookupModelPrices(model);
  return {
    promptPer1mUsd: catalog
      ? catalog.promptPer1mUsd
      : toNumber(pricing.promptPer1mUsd, DEFAULTS.promptPer1mUsd),
    completionPer1mUsd: catalog
      ? catalog.completionPer1mUsd
      : toNumber(pricing.completionPer1mUsd, DEFAULTS.completionPer1mUsd),
    usdToIdr: toNumber(pricing.usdToIdr, DEFAULTS.usdToIdr),
    imageUsd: toNumber(pricing.imageUsd, DEFAULTS.imageUsd),
    source: catalog ? 'model_catalog' : 'settings_fallback',
    matchedModel: catalog ? normalizeModelKey(model) : null,
  };
}

/**
 * Estimate cost from token usage (OpenAI-style per 1M tokens).
 * Uses per-model catalog when model is known (gpt-4o ≠ gpt-4o-mini).
 */
function computeTokenCost(
  {
    promptTokens = 0,
    completionTokens = 0,
    schemaHint = '',
    responseStatus = null,
    model = null,
  } = {},
  pricing = DEFAULTS
) {
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const completion = Math.max(0, Number(completionTokens) || 0);
  const rates = resolveRatesForModel(model, pricing);

  let costUsd =
    (prompt / 1_000_000) * rates.promptPer1mUsd +
    (completion / 1_000_000) * rates.completionPer1mUsd;

  const isImage =
    /image/i.test(String(schemaHint || '')) && prompt === 0 && completion === 0;
  if (isImage && responseStatus !== 'error') {
    costUsd = rates.imageUsd;
  }

  if (!Number.isFinite(costUsd) || costUsd < 0) costUsd = 0;

  const costIdr = costUsd * rates.usdToIdr;
  return {
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    costIdr: Math.round(costIdr * 100) / 100,
    rates,
  };
}

function formatUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function formatIdr(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Math.round(Number(value));
  return `Rp ${n.toLocaleString('id-ID')}`;
}

module.exports = {
  DEFAULTS,
  MODEL_PRICES,
  getTokenPricing,
  resolveRatesForModel,
  lookupModelPrices,
  computeTokenCost,
  formatUsd,
  formatIdr,
};
