'use strict';
/**
 * express.test.js - REAL HTTP tests of the running Express app (helmet, rate limiting, JSON errors,
 * static files). These need the npm packages, so they are skipped automatically until you have run
 * `npm install`. After `npm install`, `npm test` runs them too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

let installed = true;
for (const pkg of ['express', 'helmet', 'express-rate-limit']) {
  try {
    require.resolve(pkg);
  } catch {
    installed = false;
  }
}
const skip = installed ? false : 'express/helmet/express-rate-limit are not installed yet (run: npm install)';

const scoring = require('../src/services/scoringService');
const { TemplateExplainer } = require('../src/services/templateExplainer');
const { createGeminiService } = require('../src/services/geminiService');

async function startServer(overrides = {}) {
  const { createApp } = require('../src/app');
  const content = scoring.loadContent();
  const config = { geminiModel: 'm', recommendationsPerMinute: 50, ...overrides };
  const gemini = createGeminiService({ apiKey: '', model: 'm', logger: { warn() {} } });
  const app = createApp({ content, explainer: new TemplateExplainer(content), gemini, config });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}`, content };
}

const post = (base, body, raw = false) =>
  fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body) });

test('express: health, questions, careers, website and security headers', { skip }, async () => {
  const { server, base } = await startServer();
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.ai.configured, false);

    const q = await (await fetch(`${base}/api/questions`)).json();
    assert.equal(q.questions.length, 27);

    const c = await (await fetch(`${base}/api/careers`)).json();
    assert.ok(c.fields.length >= 15);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('Masarat'));
    const csp = page.headers.get('content-security-policy');
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(!csp.includes('upgrade-insecure-requests'));
    assert.equal(page.headers.get('x-powered-by'), null);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const js = await fetch(`${base}/js/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
  } finally {
    server.close();
  }
});

test('express: Vercel entrypoint exports the working API app', { skip }, async () => {
  const app = require('../src/index');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const questions = await fetch(`${base}/api/questions`);
    assert.equal(questions.status, 200);
    assert.equal((await questions.json()).questions.length, 27);
  } finally {
    server.close();
  }
});

test('express: recommendations - valid request, invalid answers, malformed JSON, missing body, too large, unknown path', { skip }, async () => {
  const { server, base, content } = await startServer();
  try {
    const answers = scoring.answersFromDimensions({ int_technology: 5, sk_logical: 5 }, content);
    let res = await post(base, { answers, language: 'ar', useAI: false });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recommended.length, 3);
    assert.equal(body.meta.ai.status, 'disabled');

    res = await post(base, { answers: { q01: 9 } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'invalid_request');

    res = await post(base, '{not json', true);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'invalid_json');

    res = await fetch(`${base}/api/recommendations`, { method: 'POST' });
    assert.equal(res.status, 400);

    res = await post(base, JSON.stringify({ answers, pad: 'x'.repeat(30000) }), true);
    assert.equal(res.status, 413);

    res = await fetch(`${base}/api/nothing-here`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'not_found');

  } finally {
    server.close();
  }
});

test('express: the recommendations endpoint is rate limited with a friendly JSON answer', { skip }, async () => {
  const { server, base, content } = await startServer({ recommendationsPerMinute: 2 });
  try {
    const answers = scoring.answersFromDimensions({}, content);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(base, { answers, useAI: false })).status);
    assert.deepEqual(statuses, [200, 200, 429, 429]);
    const limited = await post(base, { answers, useAI: false });
    assert.equal((await limited.json()).error.code, 'rate_limited');
  } finally {
    server.close();
  }
});
