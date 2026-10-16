'use strict';
/**
 * Tests for: request validation, the Gemini service (success, timeout, rate limit, bad output,
 * missing key), the fallback behaviour, the recommendation response structure, the route
 * handlers and the error handler.
 *
 * No internet, no API key and no Express install are needed: Gemini is replaced by fake
 * clients, and the route handlers are called with fake request/response objects.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const scoring = require('../src/services/scoringService');
const { TemplateExplainer } = require('../src/services/templateExplainer');
const { createGeminiService, GeminiError, validateInsights, buildPrompt, classifyError } = require('../src/services/geminiService');
const { createRecommendation, buildAiContext } = require('../src/services/recommendationService');
const { validateRecommendationRequest } = require('../src/utils/validation');
const { AppError } = require('../src/utils/errors');
const { errorHandler, notFoundApi } = require('../src/utils/errorHandler');
const { createHandlers } = require('../src/routes/recommendations');
const { loadConfig, DEFAULT_MODEL } = require('../src/config');
const demo = require('./fixtures/demo_students.json').students;

const content = scoring.loadContent();
const explainer = new TemplateExplainer(content);
const quietLogger = { warn() {} };
const persona = demo[0].answers_by_dimension;
const goodAnswers = () => scoring.answersFromDimensions(persona, content);
const REAL_KEY_SHAPED = 'FAKE_TEST_KEY_do_not_use_1234567890abcdef';

function fakeRes() {
  const res = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** A fake Gemini client whose answer we control. */
function fakeClient(behaviour) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (args) => {
        calls.push(args);
        return behaviour(args);
      },
    },
  };
}

/** Build a valid AI answer for the given field ids and language. */
function validAiText(ids, lang = 'en') {
  const en = {
    overview: 'You rated technology and problem solving highly, so these fields may be worth exploring further.',
    why: 'Your answers show strong interest in this area, which makes it a good one to explore.',
    tips: ['Try a free beginner course.', 'Talk to someone who studies it.'],
  };
  const ar = {
    overview: 'قيّمت التقنية وحل المشكلات تقييمًا عاليًا، لذلك قد يستحق الاستكشاف عدد من هذه المجالات.',
    why: 'تُظهر إجاباتك اهتمامًا واضحًا بهذا الجانب، مما يجعله مجالًا جيدًا للاستكشاف.',
    tips: ['جرّب دورة مجانية للمبتدئين.', 'تحدّث مع شخص يدرس هذا المجال.'],
  };
  const x = lang === 'ar' ? ar : en;
  return JSON.stringify({
    overview: x.overview,
    fields: ids.map((id) => ({ field_id: id, why: x.why, practical_suggestions: x.tips })),
  });
}

async function run(body, gemini) {
  return createRecommendation({ body, content, explainer, gemini });
}

// =================================================================== validation
test('validation: a correct body is accepted and defaults are applied', () => {
  const v = validateRecommendationRequest({ answers: goodAnswers() }, content);
  assert.equal(v.language, 'en');
  assert.equal(v.useAI, true);
});

test('validation: rejects non-objects, missing answers, bad language, bad useAI', () => {
  for (const bad of [null, undefined, 'text', 42, [], true]) {
    assert.throws(() => validateRecommendationRequest(bad, content), (e) => e instanceof AppError && e.status === 400, String(bad));
  }
  assert.throws(() => validateRecommendationRequest({}, content), (e) => e.details.includes('answers: required'));
  assert.throws(() => validateRecommendationRequest({ answers: goodAnswers(), language: 'fr' }, content), (e) => e.details[0].startsWith('language'));
  assert.throws(() => validateRecommendationRequest({ answers: goodAnswers(), useAI: 'yes' }, content), (e) => e.details[0].startsWith('useAI'));
});

test('validation: missing, invalid and unknown answers are reported (and the list is capped)', () => {
  const a = goodAnswers();
  delete a.q03;
  a.q04 = 9;
  a.q777 = 1;
  try {
    validateRecommendationRequest({ answers: a }, content);
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.code, 'invalid_request');
    assert.ok(e.details.includes('q03: missing'));
    assert.ok(e.details.some((d) => d.startsWith('q04')));
    assert.ok(e.details.includes('q777: unknown question id'));
  }
  try {
    validateRecommendationRequest({ answers: {} }, content);
  } catch (e) {
    assert.ok(e.details.length <= 11); // 10 problems + "...and N more"
  }
});

test('validation: free-text fields are ignored, not accepted into the result', () => {
  const v = validateRecommendationRequest({ answers: goodAnswers(), name: 'Sara', email: 'a@b.c' }, content);
  assert.deepEqual(Object.keys(v).sort(), ['answers', 'language', 'useAI']);
});

// ==================================================================== config
test('config: placeholder or empty key means AI is not configured; model is configurable', () => {
  assert.equal(loadConfig({ GEMINI_API_KEY: 'your_gemini_api_key_here' }).geminiApiKey, '');
  assert.equal(loadConfig({ GEMINI_API_KEY: '   ' }).geminiApiKey, '');
  assert.equal(loadConfig({}).geminiModel, DEFAULT_MODEL);
  assert.equal(loadConfig({ GEMINI_MODEL: 'my-model' }).geminiModel, 'my-model');
  assert.equal(loadConfig({ GEMINI_API_KEY: REAL_KEY_SHAPED }).geminiApiKey, REAL_KEY_SHAPED);
  assert.equal(loadConfig({ PORT: 'abc' }).port, 3000);
});

// ============================================================ gemini: success
test('gemini: valid JSON from the model is accepted and returned', async () => {
  const base = scoring.recommend(goodAnswers(), content);
  const ids = base.recommended.map((r) => r.field_id);
  const client = fakeClient(() => ({ text: validAiText(ids) }));
  const gemini = createGeminiService({ apiKey: 'x', model: 'm', client, logger: quietLogger });
  const insights = await gemini.generateInsights(buildAiContext(base, 'en', content, explainer));
  assert.deepEqual(Object.keys(insights.fields).sort(), [...ids].sort());
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, 'm');
  assert.equal(client.calls[0].config.responseMimeType, 'application/json');
});

test('gemini: the prompt contains only anonymous scoring data, no key and no free text', () => {
  const base = scoring.recommend(goodAnswers(), content);
  const prompt = buildPrompt(buildAiContext(base, 'en', content, explainer));
  assert.ok(prompt.includes('field_id'));
  assert.ok(prompt.includes('compatibility_score'));
  assert.ok(!prompt.includes('FAKE_TEST_KEY'));
  assert.ok(!/email|password|phone/i.test(JSON.stringify(buildAiContext(base, 'en', content, explainer))));
});

test('gemini: JSON wrapped in code fences is still accepted', () => {
  const ids = ['computer_science'];
  const wrapped = '```json\n' + validAiText(ids) + '\n```';
  assert.ok(validateInsights(wrapped, ids, 'en').fields.computer_science);
});

// ============================================================ gemini: failures
test('gemini: no key -> not_configured, and the SDK is never loaded', async () => {
  let loaded = false;
  const gemini = createGeminiService({ apiKey: '', model: 'm', loadSdk: async () => { loaded = true; }, logger: quietLogger });
  assert.equal(gemini.isConfigured, false);
  await assert.rejects(() => gemini.generateInsights({ language: 'en', fields: [] }), (e) => e.code === 'not_configured');
  assert.equal(loaded, false);
});

test('gemini: a slow answer times out', async () => {
  const client = fakeClient(() => new Promise(() => {})); // never answers
  const gemini = createGeminiService({ apiKey: 'x', model: 'm', client, timeoutMs: 30, logger: quietLogger });
  const base = scoring.recommend(goodAnswers(), content);
  await assert.rejects(() => gemini.generateInsights(buildAiContext(base, 'en', content, explainer)), (e) => e.code === 'timeout');
});

test('gemini: rate limit (429), auth and server errors are classified without leaking details', async () => {
  const base = scoring.recommend(goodAnswers(), content);
  const context = buildAiContext(base, 'en', content, explainer);
  const cases = [
    [{ status: 429, message: 'RESOURCE_EXHAUSTED' }, 'rate_limited'],
    [{ status: 403, message: 'API key not valid ' + REAL_KEY_SHAPED }, 'auth'],
    [{ status: 500, message: 'boom with secret ' + REAL_KEY_SHAPED }, 'unavailable'],
    [new Error('fetch failed'), 'unavailable'],
  ];
  for (const [error, code] of cases) {
    const gemini = createGeminiService({ apiKey: 'x', model: 'm', client: fakeClient(() => { throw error; }), logger: quietLogger });
    await assert.rejects(() => gemini.generateInsights(context), (e) => {
      assert.ok(e instanceof GeminiError);
      assert.equal(e.code, code);
      assert.ok(!e.message.includes('FAKE_TEST_KEY'), 'error message must not contain the key');
      return true;
    });
  }
  assert.equal(classifyError(Object.assign(new Error('x'), { name: 'AbortError' })).code, 'timeout');
});

test('gemini: invalid or unsafe model output is rejected', () => {
  const ids = ['computer_science', 'data_science'];
  const good = JSON.parse(validAiText(ids));
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(good)); fn(c); return c; };
  const bad = {
    'not JSON': 'this is not json',
    'array at top': [],
    'missing overview': mutate((c) => delete c.overview),
    'missing field': mutate((c) => c.fields.pop()),
    'unknown field id': mutate((c) => { c.fields[0].field_id = 'astrology'; }),
    'duplicate field id': mutate((c) => { c.fields[1].field_id = c.fields[0].field_id; }),
    'too many suggestions': mutate((c) => { c.fields[0].practical_suggestions = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd']; }),
    'one suggestion only': mutate((c) => { c.fields[0].practical_suggestions = ['aaaaaaaaaa']; }),
    'claims certainty': mutate((c) => { c.fields[0].why = 'You will definitely succeed in this field of study.'; }),
    'guarantee': mutate((c) => { c.overview = 'This path is a guarantee of a great career for you.'; }),
    'contains link': mutate((c) => { c.fields[0].why = 'Learn more at https://example.com/course today please.'; }),
    'contains percentage': mutate((c) => { c.fields[0].why = 'You are an 86% match for this field of study.'; }),
    'contains markup': mutate((c) => { c.fields[0].why = 'Try this <script>alert(1)</script> field of study.'; }),
    'too long': mutate((c) => { c.overview = 'x'.repeat(701); }),
    'wrong language (Arabic when English asked)': mutate((c) => { c.overview = 'قيّمت التقنية وحل المشكلات تقييمًا عاليًا في إجاباتك.'; }),
  };
  for (const [name, value] of Object.entries(bad)) {
    assert.throws(() => validateInsights(value, ids, 'en'), (e) => e instanceof GeminiError && e.code === 'invalid_response', name);
  }
  // English text is rejected when Arabic was requested.
  assert.throws(() => validateInsights(validAiText(ids, 'en'), ids, 'ar'), (e) => e.code === 'invalid_response');
  // Arabic certainty phrase
  const arCertain = JSON.parse(validAiText(ids, 'ar'));
  arCertain.fields[0].why = 'ستصبح بالتأكيد ناجحًا جدًا في هذا المجال الدراسي.';
  assert.throws(() => validateInsights(arCertain, ids, 'ar'), (e) => e.code === 'invalid_response');
  // And the good Arabic answer passes.
  assert.ok(validateInsights(validAiText(ids, 'ar'), ids, 'ar').overview);
});

test('gemini: an empty or non-text model response is rejected', async () => {
  const base = scoring.recommend(goodAnswers(), content);
  const context = buildAiContext(base, 'en', content, explainer);
  for (const response of [{ text: '' }, { text: undefined }, {}, null]) {
    const gemini = createGeminiService({ apiKey: 'x', model: 'm', client: fakeClient(() => response), logger: quietLogger });
    await assert.rejects(() => gemini.generateInsights(context), (e) => e.code === 'invalid_response');
  }
});

// =============================================== recommendations: structure
test('response structure: all required parts are present (template mode)', async () => {
  const r = await run({ answers: goodAnswers(), language: 'en', useAI: false }, null);
  for (const key of ['language', 'labels', 'meta', 'profile', 'ai_overview', 'recommended', 'alternatives', 'warnings']) assert.ok(key in r, key);
  assert.equal(r.language, 'en');
  assert.equal(r.recommended.length, content.config.selection.top_n);
  assert.equal(r.alternatives.length, content.config.selection.alternatives_n);
  assert.ok(r.labels.disclaimer.includes('not a professional diagnosis'));
  assert.equal(r.meta.ai.status, 'disabled');
  assert.equal(r.ai_overview, null);

  const f = r.recommended[0];
  for (const key of ['field_id', 'name', 'rank', 'overall_rank', 'score', 'band', 'band_label', 'explanation', 'contributions', 'next_steps', 'related']) assert.ok(key in f, key);
  assert.ok(f.score >= 0 && f.score <= 100);
  assert.ok(f.explanation.text.length > 20);
  assert.equal(f.explanation.source, 'template');
  for (const key of ['subjects', 'majors', 'careers', 'skills', 'activities', 'questions']) assert.ok(f.next_steps[key].length >= 2, key);
  assert.deepEqual(r.recommended.map((x) => x.rank), [1, 2, 3]);
  assert.ok(r.alternatives.every((x) => x.rank === null));
  JSON.stringify(r);
});

test('response is localised: Arabic request gives Arabic names, labels and steps', async () => {
  const r = await run({ answers: goodAnswers(), language: 'ar', useAI: false }, null);
  const arabic = (s) => /[\u0600-\u06FF]/.test(s);
  assert.ok(arabic(r.recommended[0].name));
  assert.ok(arabic(r.labels.score_label));
  assert.ok(arabic(r.recommended[0].explanation.text));
  assert.ok(arabic(r.recommended[0].next_steps.subjects[0]));
  assert.ok(arabic(r.labels.disclaimer));
});

test('response never contains the API key or internal details', async () => {
  const gemini = createGeminiService({ apiKey: REAL_KEY_SHAPED, model: 'm', client: fakeClient(() => { throw new Error(REAL_KEY_SHAPED); }), logger: quietLogger });
  const r = await run({ answers: goodAnswers(), language: 'en' }, gemini);
  const text = JSON.stringify(r);
  assert.ok(!text.includes('FAKE_TEST_KEY') && !text.includes(REAL_KEY_SHAPED));
  assert.ok(!/stack|node_modules|\/home\//i.test(text));
});

// ========================================================= fallback behaviour
test('FALLBACK: no key -> complete template result, reason not_configured', async () => {
  const gemini = createGeminiService({ apiKey: '', model: 'm', logger: quietLogger });
  const r = await run({ answers: goodAnswers(), language: 'en', useAI: true }, gemini);
  assert.equal(r.meta.ai.status, 'fallback');
  assert.equal(r.meta.ai.reason, 'not_configured');
  assert.equal(r.recommended[0].explanation.source, 'template');
  assert.equal(r.recommended.length, 3);
});

test('FALLBACK: timeout, rate limit, bad output and server error all still return a full result', async () => {
  const base = scoring.recommend(goodAnswers(), content);
  const ids = base.recommended.map((x) => x.field_id);
  const behaviours = {
    timeout: () => new Promise(() => {}),
    rate_limited: () => { throw { status: 429 }; },
    invalid_response: () => ({ text: 'sorry I cannot help' }),
    unavailable: () => { throw new Error('network down'); },
  };
  for (const [reason, behaviour] of Object.entries(behaviours)) {
    const gemini = createGeminiService({ apiKey: 'x', model: 'm', client: fakeClient(behaviour), timeoutMs: 30, logger: quietLogger });
    const r = await run({ answers: goodAnswers(), language: 'en' }, gemini);
    assert.equal(r.meta.ai.status, 'fallback', reason);
    assert.equal(r.meta.ai.reason, reason);
    assert.deepEqual(r.recommended.map((x) => x.field_id), ids, 'ranking must not change when AI fails');
    assert.ok(r.recommended.every((x) => x.explanation.source === 'template' && x.explanation.text.length > 20));
  }
});

test('AI success: AI text is used but scores, order and bands are IDENTICAL to the no-AI result', async () => {
  const noAi = await run({ answers: goodAnswers(), language: 'en', useAI: false }, null);
  const ids = noAi.recommended.map((x) => x.field_id);
  const gemini = createGeminiService({ apiKey: 'x', model: 'fake-model', client: fakeClient(() => ({ text: validAiText(ids) })), logger: quietLogger });
  const withAi = await run({ answers: goodAnswers(), language: 'en', useAI: true }, gemini);

  assert.equal(withAi.meta.ai.status, 'used');
  assert.equal(withAi.meta.ai.model, 'fake-model');
  assert.ok(withAi.ai_overview);
  assert.ok(withAi.recommended.every((x) => x.explanation.source === 'ai' && x.ai_suggestions.length >= 2));
  assert.ok(withAi.recommended.every((x) => x.explanation.template_text.length > 20)); // template text kept too

  const pick = (r) => [...r.recommended, ...r.alternatives].map((x) => [x.field_id, x.score, x.band, x.rank, x.overall_rank]);
  assert.deepEqual(pick(withAi), pick(noAi));
});

test('AI is skipped entirely when the student turns it off', async () => {
  const client = fakeClient(() => ({ text: '{}' }));
  const gemini = createGeminiService({ apiKey: 'x', model: 'm', client, logger: quietLogger });
  const r = await run({ answers: goodAnswers(), language: 'en', useAI: false }, gemini);
  assert.equal(r.meta.ai.status, 'disabled');
  assert.equal(client.calls.length, 0);
});

test('invalid requests never reach Gemini', async () => {
  const client = fakeClient(() => ({ text: '{}' }));
  const gemini = createGeminiService({ apiKey: 'x', model: 'm', client, logger: quietLogger });
  await assert.rejects(() => run({ answers: { q01: 5 } }, gemini), (e) => e.status === 400);
  assert.equal(client.calls.length, 0);
});

// ============================================================= route handlers
test('handlers: health reports configuration without claiming the AI works', () => {
  const config = { geminiModel: 'm' };
  const on = createHandlers({ content, explainer, gemini: createGeminiService({ apiKey: 'x', model: 'm', logger: quietLogger }), config });
  const off = createHandlers({ content, explainer, gemini: createGeminiService({ apiKey: '', model: 'm', logger: quietLogger }), config });
  let res = fakeRes();
  on.health({}, res);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.ai.configured, true);
  assert.ok(!/apikey|api_key/i.test(JSON.stringify(res.body)));
  res = fakeRes();
  off.health({}, res);
  assert.equal(res.body.ai.configured, false);
  assert.equal(res.body.ai.model, null);
});

test('handlers: questions endpoint returns 27 bilingual questions and no scoring weights', () => {
  const handlers = createHandlers({ content, explainer, gemini: null, config: {} });
  const res = fakeRes();
  handlers.questions({}, res);
  assert.equal(res.body.questions.length, 27);
  assert.ok(res.body.questions.every((q) => q.text_en && q.text_ar && q.group));
  assert.ok(res.body.questions.filter((q) => q.type === 'bipolar').every((q) => q.low_en && q.high_ar));
  assert.ok(!('profile' in res.body) && !JSON.stringify(res.body).includes('"weight"'));
  assert.equal(res.body.scale.max, 5);
});

test('handlers: careers endpoint lists all fields with info', () => {
  const handlers = createHandlers({ content, explainer, gemini: null, config: {} });
  const res = fakeRes();
  handlers.careers({}, res);
  assert.equal(res.body.fields.length, Object.keys(content.fieldsDoc.fields).length);
  assert.ok(res.body.fields.every((f) => f.name_ar && f.info));
  assert.ok(!JSON.stringify(res.body).includes('"profile"'));
});

test('handlers: recommendations passes errors to next() and sends results otherwise', async () => {
  const handlers = createHandlers({ content, explainer, gemini: null, config: {} });
  let res = fakeRes();
  await handlers.recommendations({ body: { answers: goodAnswers(), useAI: false } }, res, () => assert.fail('no error expected'));
  assert.equal(res.body.recommended.length, 3);

  res = fakeRes();
  let passed = null;
  await handlers.recommendations({ body: { answers: {} } }, res, (e) => { passed = e; });
  assert.ok(passed instanceof AppError && passed.status === 400);
  assert.equal(res.body, undefined);

  passed = null;
  await handlers.recommendations({ body: undefined }, fakeRes(), (e) => { passed = e; }); // Express 5 leaves body undefined
  assert.equal(passed.status, 400);
});

// ============================================================== error handler
test('errorHandler: safe JSON for validation, bad JSON, too large, unknown and 404', () => {
  let res = fakeRes();
  errorHandler(new AppError(400, 'invalid_request', 'Bad input.', ['q01: missing']), {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.error, { code: 'invalid_request', message: 'Bad input.', details: ['q01: missing'] });

  res = fakeRes();
  errorHandler(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' }), {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'invalid_json');

  res = fakeRes();
  errorHandler(Object.assign(new Error('big'), { type: 'entity.too.large' }), {}, res, () => {});
  assert.equal(res.statusCode, 413);

  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    res = fakeRes();
    const secret = new Error('db password is hunter2 at /home/me/app.js:12 ' + REAL_KEY_SHAPED);
    secret.stack = 'Error: secret stack trace';
    errorHandler(secret, {}, res, () => {});
    assert.equal(res.statusCode, 500);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('hunter2') && !text.includes('stack') && !text.includes('FAKE_TEST_KEY') && !text.includes('/home/'));
    assert.ok(logged.every((l) => !l.includes('hunter2') && !l.includes('FAKE_TEST_KEY')));
  } finally {
    console.error = original;
  }

  res = fakeRes();
  notFoundApi({}, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'not_found');
});
