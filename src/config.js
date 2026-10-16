'use strict';
/**
 * config.js - reads settings from environment variables (loaded from .env by server.js).
 * The Gemini key is read ONLY here and is never sent to the browser or written to logs.
 */

const PLACEHOLDER_KEY = 'your_gemini_api_key_here';
// A model name that is stable and low-cost at the time of writing. Change it in .env (GEMINI_MODEL).
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadConfig(env = process.env) {
  const rawKey = (env.GEMINI_API_KEY || '').trim();
  const keyIsSet = rawKey !== '' && rawKey !== PLACEHOLDER_KEY;
  return {
    port: toPositiveInt(env.PORT, 3000),
    geminiApiKey: keyIsSet ? rawKey : '',
    geminiModel: (env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL,
    geminiTimeoutMs: toPositiveInt(env.GEMINI_TIMEOUT_MS, 20000),
    // Requests per minute per IP for POST /api/recommendations (protects your Gemini quota).
    recommendationsPerMinute: toPositiveInt(env.RATE_LIMIT_PER_MINUTE, 6),
    isProduction: env.NODE_ENV === 'production',
  };
}

module.exports = { loadConfig, DEFAULT_MODEL, PLACEHOLDER_KEY };
