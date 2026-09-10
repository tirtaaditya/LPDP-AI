const db = require('../db');

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
  };
}

/**
 * Estimate cost from token usage (OpenAI-style per 1M tokens).
 * For image generation with no tokens, use flat image price when mode hints image.
 */
function computeTokenCost(
  {
    promptTokens = 0,
    completionTokens = 0,
    schemaHint = '',
    responseStatus = null,
  } = {},
  pricing = DEFAULTS
) {
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const completion = Math.max(0, Number(completionTokens) || 0);
  const rates = {
    promptPer1mUsd: toNumber(pricing.promptPer1mUsd, DEFAULTS.promptPer1mUsd),
    completionPer1mUsd: toNumber(
      pricing.completionPer1mUsd,
      DEFAULTS.completionPer1mUsd
    ),
    usdToIdr: toNumber(pricing.usdToIdr, DEFAULTS.usdToIdr),
    imageUsd: toNumber(pricing.imageUsd, DEFAULTS.imageUsd),
  };

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
  getTokenPricing,
  computeTokenCost,
  formatUsd,
  formatIdr,
};
