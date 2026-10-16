'use strict';
/**
 * smoke.js - quick check of a RUNNING server.   Usage:  npm run smoke
 * (start the server first in another terminal with: npm run dev)
 *
 * It calls the real endpoints over HTTP and prints PASS/FAIL for each. It never prints your key.
 * It sends useAI:false, so it does NOT use Gemini or your quota. Use `npm run check-ai` for Gemini.
 */

const base = process.env.SMOKE_URL || `http://localhost:${process.env.PORT || 3000}`;
let failures = 0;

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  - ' + extra : ''}`);
  if (!ok) failures += 1;
}

async function getJson(path, options) {
  const res = await fetch(base + path, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

(async () => {
  try {
    const health = await getJson('/api/health');
    report('GET /api/health', health.status === 200 && health.body.status === 'ok', `ai.configured=${health.body?.ai?.configured}`);

    const q = await getJson('/api/questions');
    const questions = q.body?.questions || [];
    report('GET /api/questions', q.status === 200 && questions.length === 27, `${questions.length} questions`);

    const c = await getJson('/api/careers');
    report('GET /api/careers', c.status === 200 && c.body.fields.length > 0, `${c.body?.fields?.length} fields`);

    const answers = Object.fromEntries(questions.map((item, i) => [item.id, (i % 5) + 1]));
    const post = (payload) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

    const ok = await getJson('/api/recommendations', post({ answers, language: 'en', useAI: false }));
    report('POST /api/recommendations (valid)', ok.status === 200 && ok.body.recommended?.length === 3, `top: ${ok.body?.recommended?.[0]?.name}`);

    const bad = await getJson('/api/recommendations', post({ answers: { q01: 9 }, language: 'en' }));
    report('POST /api/recommendations (invalid answers -> 400)', bad.status === 400 && bad.body?.error?.code === 'invalid_request');

    const broken = await fetch(base + '/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    report('POST malformed JSON -> 400', broken.status === 400);

    const page = await fetch(base + '/');
    const html = await page.text();
    report('GET / (website)', page.status === 200 && html.includes('<html'));

    const csp = page.headers.get('content-security-policy');
    report('Security headers present (helmet)', Boolean(csp));
  } catch (err) {
    console.log(`FAIL  could not reach ${base} - is the server running? (npm run dev)  [${err.message}]`);
    failures += 1;
  }
  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
