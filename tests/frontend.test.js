'use strict';
/**
 * Checks on the frontend files that do not need a browser:
 *  - English and Arabic UI strings have exactly the same keys, with no empty values
 *  - every data-i18n key used in index.html exists
 *  - every element id that the scripts look up exists in index.html
 *  - no inline scripts / inline event handlers (the security policy blocks them)
 *  - the page has the accessibility basics (lang, dir, viewport, skip link)
 *  - the JavaScript files are syntactically valid and never mention the Gemini key
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const i18n = require('../public/js/i18n.js');
const jsFiles = ['i18n.js', 'dom.js', 'questionnaire.js', 'results.js', 'app.js'];
const jsSource = Object.fromEntries(jsFiles.map((f) => [f, fs.readFileSync(path.join(PUBLIC, 'js', f), 'utf8')]));

test('English and Arabic strings have identical keys and no empty values', () => {
  const en = Object.keys(i18n.STRINGS.en).sort();
  const ar = Object.keys(i18n.STRINGS.ar).sort();
  assert.deepEqual(ar, en);
  for (const lang of ['en', 'ar']) {
    for (const [k, v] of Object.entries(i18n.STRINGS[lang])) assert.ok(String(v).trim().length > 0, `${lang}.${k}`);
  }
});

test('Arabic strings are actually Arabic, and placeholders match between languages', () => {
  for (const [k, v] of Object.entries(i18n.STRINGS.ar)) {
    if (k === 'app_name' || /^lang_/.test(k)) continue;
    assert.ok(/[\u0600-\u06FF]/.test(v), `ar.${k} has no Arabic text`);
    const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    assert.equal(placeholders(v), placeholders(i18n.STRINGS.en[k]), `placeholders differ for ${k}`);
  }
});

test('t() fills placeholders and falls back safely', () => {
  assert.equal(i18n.t('en', 'progress_count', { n: 7, total: 27 }), 'Question 7 of 27');
  assert.ok(i18n.t('ar', 'progress_count', { n: 7, total: 27 }).includes('7'));
  assert.equal(i18n.t('en', 'no_such_key'), 'no_such_key');
  assert.equal(i18n.t('xx', 'back'), i18n.STRINGS.en.back);
});

test('every data-i18n key in index.html exists in both languages', () => {
  const keys = [...html.matchAll(/data-i18n(?:-aria)?="([\w]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 15);
  for (const k of keys) {
    assert.ok(k in i18n.STRINGS.en, `missing en.${k}`);
    assert.ok(k in i18n.STRINGS.ar, `missing ar.${k}`);
  }
});

test('every key used by the scripts via t("...") exists in both languages', () => {
  for (const file of ['questionnaire.js', 'results.js', 'app.js']) {
    const src = jsSource[file];
    // t('key') or t('key', {...}) with a fixed key, plus keys inside conditionals: ? 'key_a' : 'key_b'
    const used = [...src.matchAll(/\bt\('([\w]+)'\s*[,)]/g)].map((m) => m[1]);
    for (const m of src.matchAll(/\?\s*'([a-z]+(?:_[a-z0-9]+)+)'\s*:\s*'([a-z]+(?:_[a-z0-9]+)+)'/g)) used.push(m[1], m[2]);
    const dynamic = ['bipolar_1', 'bipolar_2', 'bipolar_3', 'bipolar_4', 'bipolar_5', 'ai_reason_not_configured', 'ai_reason_timeout', 'ai_reason_rate_limited', 'ai_reason_auth', 'ai_reason_invalid_response', 'ai_reason_unavailable'];
    for (const k of [...used, ...dynamic]) {
      assert.ok(k in i18n.STRINGS.en && k in i18n.STRINGS.ar, `${file}: unknown key ${k}`);
    }
  }
});

test('every id the scripts look up exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]));
  const wanted = new Set();
  for (const src of Object.values(jsSource)) {
    for (const m of src.matchAll(/\$\('([\w-]+)'\)/g)) wanted.add(m[1]);
    for (const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) wanted.add(m[1]);
  }
  // ids created by results.js itself
  for (const created of ['areas-title', 'recommended-title', 'alt-title', 'results-title']) wanted.delete(created);
  for (const id of wanted) assert.ok(ids.has(id), `index.html has no id="${id}"`);
});

test('HTML has no inline scripts, inline handlers or inline styles (blocked by the CSP)', () => {
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'inline <script> found');
  assert.ok(!/\son\w+\s*=/i.test(html), 'inline event handler found');
  assert.ok(!/\sstyle\s*=/i.test(html), 'inline style attribute found');
});

test('HTML accessibility basics', () => {
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<h1 /);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-pressed/);
  assert.ok(!/<img\s(?![^>]*\balt=)/i.test(html), 'img without alt');
});

test('scripts are loaded in dependency order', () => {
  const order = [...html.matchAll(/<script src="\/js\/([\w.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['i18n.js', 'dom.js', 'questionnaire.js', 'results.js', 'app.js']);
});

test('frontend scripts are valid JavaScript', () => {
  for (const [file, src] of Object.entries(jsSource)) {
    assert.doesNotThrow(() => new vm.Script(src, { filename: file }), file);
  }
});

test('the Gemini key and SDK are never referenced in frontend code', () => {
  for (const [file, src] of Object.entries(jsSource)) {
    assert.ok(!/GEMINI_API_KEY|@google\/genai|generativelanguage|AIza/i.test(src), file);
  }
  assert.ok(!/GEMINI_API_KEY|AIza/.test(html));
});

test('results.js and dom.js never insert server text as HTML', () => {
  for (const file of ['results.js', 'dom.js', 'questionnaire.js', 'app.js']) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(jsSource[file]), file);
  }
});

test('CSS uses logical properties for RTL and has no external requests', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css', 'styles.css'), 'utf8');
  assert.match(css, /inline-start|padding-inline|margin-inline/);
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(css));
  assert.ok(!/margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
});
