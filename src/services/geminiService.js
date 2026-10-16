'use strict';
/**
 * geminiService.js - the ONLY file that talks to Google Gemini.
 *
 * What Gemini does here: write a short, personal, readable explanation and a few
 * practical suggestions for fields that the deterministic scoring engine has ALREADY
 * chosen. Gemini never changes scores or rankings.
 *
 * What is sent to Gemini: only anonymous scoring information (labels such as
 * "interest in technology" with the student's 1-5 answer, plus the field scores).
 * There is no free text, name, email or any identifying data in the app, so none can be sent.
 *
 * What comes back is checked by validateInsights() before anyone sees it. If anything goes
 * wrong (no key, timeout, rate limit, bad output) a GeminiError with a short safe `code` is
 * thrown and the caller falls back to the template explanations.
 *
 * SDK: official `@google/genai` -> new GoogleGenAI({ apiKey }) and ai.models.generateContent(...).
 */

const OVERVIEW_MAX = 700;
const WHY_MAX = 600;
const SUGGESTION_MAX = 220;
const SUGGESTIONS_MIN = 2;
const SUGGESTIONS_MAX = 3;

class GeminiError extends Error {
  /** @param {'not_configured'|'timeout'|'rate_limited'|'auth'|'invalid_response'|'unavailable'} code */
  constructor(code, message) {
    super(message || code);
    this.name = 'GeminiError';
    this.code = code;
  }
}

// Phrases that would present a guess as a certainty. Output containing them is rejected.
const CERTAINTY_PATTERNS = [
  /definitely/i,
  /guarantee/i,
  /certainly (will|are|is)/i,
  /you will (become|succeed|be a|be an)/i,
  /you (must|have to|need to) (become|study|choose|pick)/i,
  /no doubt/i,
  /the (only|perfect|ideal) (career|field|major|path|choice) for you/i,
  /you are (clearly|obviously|definitely) (suited|made|meant)/i,
  /بالتأكيد/,
  /حتما|حتمًا|حتماً/,
  /مضمون/,
  /ستصبح/,
  /يجب (عليك )?أن (تصبح|تدرس|تختار)/,
  /لا شك/,
  /(المجال|التخصص|المسار) (الوحيد|المثالي)/,
];

// ------------------------------------------------------------------ prompt
const SYSTEM_INSTRUCTION = [
  'You write short, friendly guidance for secondary-school and university students in the Arab world who are exploring which academic fields to look into.',
  'You are given anonymous results from a questionnaire: which areas the student rated highly, and a compatibility score for each field.',
  'Rules you must follow:',
  '1. Use ONLY the information in the provided JSON. Never invent answers, interests, grades, personal details or facts about the student.',
  '2. Describe fields as options to EXPLORE. Never say a field is definitely right, best, or the only choice. Never predict success, income or job availability.',
  '3. The compatibility score is NOT a probability. Do not write percentages and do not repeat the numeric scores.',
  '4. Do not include web links, email addresses, or names of specific schools, companies or products.',
  '5. Be practical: suggest small, concrete activities, subjects or skills the student can try.',
  '6. Write in the requested language, in simple wording that a teenager can understand. For Arabic use clear Modern Standard Arabic.',
  '7. Reply with JSON only, in exactly the requested shape.',
].join('\n');

/** The JSON shape we ask for (also documented in the README). */
const OUTPUT_SHAPE_DESCRIPTION = `{
  "overview": "2-4 sentences connecting the student's strongest areas to the suggested fields",
  "fields": [
    {
      "field_id": "<one of the provided field_id values, copied exactly>",
      "why": "2-4 sentences explaining why this field may be worth exploring, using only the provided matches",
      "practical_suggestions": ["2 to 3 short concrete suggestions (subjects to explore, skills to practise, small activities)"]
    }
  ]
}`;

/** Build the user message. `context` comes from recommendationService (anonymous labels only). */
function buildPrompt(context) {
  const languageName = context.language === 'ar' ? 'Arabic' : 'English';
  return [
    `Write in ${languageName}.`,
    'Return one entry in "fields" for EACH field in the data below, using the same field_id values.',
    'Required JSON shape:',
    OUTPUT_SHAPE_DESCRIPTION,
    '',
    'Student results (anonymous):',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

// ------------------------------------------------------------- validation
function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

/** Throws GeminiError('invalid_response') if one string from the AI is not acceptable. */
function checkText(text, maxLength, language, label) {
  const bad = (why) => new GeminiError('invalid_response', `${label}: ${why}`);
  if (typeof text !== 'string') throw bad('not a string');
  const t = text.trim();
  if (t.length < 8) throw bad('too short');
  if (t.length > maxLength) throw bad('too long');
  if (/[<>]/.test(t)) throw bad('contains markup');
  if (/https?:\/\/|www\./i.test(t)) throw bad('contains a link');
  if (/[%٪]/.test(t)) throw bad('contains a percentage');
  if (CERTAINTY_PATTERNS.some((p) => p.test(t))) throw bad('claims certainty');

  const arabic = countMatches(t, /[\u0600-\u06FF]/g);
  const latin = countMatches(t, /[A-Za-z]/g);
  const letters = arabic + latin;
  if (letters > 0) {
    const arabicShare = arabic / letters;
    if (language === 'ar' && arabicShare < 0.6) throw bad('not written in Arabic');
    if (language === 'en' && arabicShare > 0.05) throw bad('not written in English');
  }
  // Remove control characters (keep normal whitespace).
  return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Check the model's JSON and return a clean object:
 *   { overview: string, fields: { [field_id]: { why: string, practical_suggestions: string[] } } }
 * Anything unexpected throws GeminiError('invalid_response').
 */
function validateInsights(raw, expectedFieldIds, language) {
  const fail = (why) => new GeminiError('invalid_response', why);

  let data = raw;
  if (typeof raw === 'string') {
    // Some models wrap JSON in ```json fences even when asked not to.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      data = JSON.parse(cleaned);
    } catch {
      throw fail('not valid JSON');
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw fail('top level must be an object');

  const overview = checkText(data.overview, OVERVIEW_MAX, language, 'overview');

  if (!Array.isArray(data.fields)) throw fail('fields must be an array');
  const expected = new Set(expectedFieldIds);
  const result = {};
  for (const item of data.fields) {
    if (item === null || typeof item !== 'object') throw fail('field entry must be an object');
    const id = item.field_id;
    if (typeof id !== 'string' || !expected.has(id)) throw fail('unknown field_id');
    if (Object.prototype.hasOwnProperty.call(result, id)) throw fail('duplicate field_id');
    const why = checkText(item.why, WHY_MAX, language, `why(${id})`);
    const list = item.practical_suggestions;
    if (!Array.isArray(list) || list.length < SUGGESTIONS_MIN || list.length > SUGGESTIONS_MAX) {
      throw fail(`practical_suggestions(${id}) must have ${SUGGESTIONS_MIN}-${SUGGESTIONS_MAX} items`);
    }
    result[id] = {
      why,
      practical_suggestions: list.map((s, i) => checkText(s, SUGGESTION_MAX, language, `suggestion(${id}.${i})`)),
    };
  }
  if (Object.keys(result).length !== expected.size) throw fail('a field is missing');
  return { overview, fields: result };
}

// --------------------------------------------------------- error handling
/** Turn any SDK/network error into a GeminiError with a short safe code (no details leak). */
function classifyError(err) {
  if (err instanceof GeminiError) return err;
  const status = Number(err?.status ?? err?.code ?? err?.error?.code);
  const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
  if (err?.name === 'AbortError' || text.includes('timeout') || text.includes('timed out')) return new GeminiError('timeout');
  if (status === 429 || text.includes('resource_exhausted') || text.includes('rate limit') || text.includes('quota')) {
    return new GeminiError('rate_limited');
  }
  if (status === 401 || status === 403 || text.includes('api key') || text.includes('permission_denied')) {
    return new GeminiError('auth');
  }
  return new GeminiError('unavailable');
}

/** Run `promise` but give up after `ms` (and abort the request if possible). */
function withTimeout(makePromise, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GeminiError('timeout'));
    }, ms);
  });
  return Promise.race([makePromise(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

// ----------------------------------------------------------------- service
/** Load the real SDK only when needed, so the app and the tests run without it. */
async function defaultLoadSdk() {
  return import('@google/genai');
}

/**
 * @param {object} options
 * @param {string} options.apiKey      Gemini key (from process.env via config.js). Empty = AI disabled.
 * @param {string} options.model       Model name, e.g. "gemini-3.5-flash-lite".
 * @param {number} [options.timeoutMs] Give up after this many milliseconds.
 * @param {object} [options.client]    Injected client with models.generateContent (used by tests).
 * @param {Function} [options.loadSdk] Injected SDK loader (used by tests).
 * @param {object} [options.logger]    Something with .warn()
 */
function createGeminiService({ apiKey, model, timeoutMs = 20000, client = null, loadSdk = defaultLoadSdk, logger = console }) {
  const isConfigured = Boolean(client) || Boolean(apiKey);
  let cachedClient = client;

  async function getClient() {
    if (cachedClient) return cachedClient;
    const { GoogleGenAI } = await loadSdk();
    cachedClient = new GoogleGenAI({ apiKey });
    return cachedClient;
  }

  /**
   * @param {object} context  anonymous scoring context (see recommendationService.buildAiContext)
   * @returns {Promise<{overview: string, fields: object}>} validated insights
   * @throws {GeminiError}
   */
  async function generateInsights(context) {
    if (!isConfigured) throw new GeminiError('not_configured');
    try {
      const ai = await getClient();
      const response = await withTimeout(
        (signal) =>
          ai.models.generateContent({
            model,
            contents: buildPrompt(context),
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              temperature: 0.4,
              maxOutputTokens: 4096,
              abortSignal: signal,
            },
          }),
        timeoutMs
      );
      const text = response?.text;
      if (typeof text !== 'string' || text.trim() === '') throw new GeminiError('invalid_response', 'empty response');
      return validateInsights(text, context.fields.map((f) => f.field_id), context.language);
    } catch (err) {
      const e = classifyError(err);
      // Log only the short code, never the raw error (it could contain request details).
      logger.warn(`[gemini] request failed: ${e.code}`);
      throw e;
    }
  }

  return { isConfigured, model, generateInsights };
}

module.exports = {
  createGeminiService,
  GeminiError,
  validateInsights,
  buildPrompt,
  classifyError,
  SYSTEM_INSTRUCTION,
};
