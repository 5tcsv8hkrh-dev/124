'use strict';
/**
 * flow.test.js - runs the REAL frontend scripts (i18n, dom, questionnaire, results, app) inside a
 * minimal fake browser, with fetch() connected to the REAL route handlers. It clicks through:
 * start -> 27 questions -> results -> switch language -> restart, plus error cases.
 *
 * This is NOT a replacement for opening the site in a real browser (layout, colours and real
 * keyboard behaviour are not tested here). It does catch script mistakes and broken wiring.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scoring = require('../src/services/scoringService');
const { TemplateExplainer } = require('../src/services/templateExplainer');
const { createGeminiService } = require('../src/services/geminiService');
const { createHandlers } = require('../src/routes/recommendations');
const { errorHandler } = require('../src/utils/errorHandler');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

// ------------------------------------------------------------ fake browser
class FakeNode {
  constructor() { this.children = []; this.parent = null; }
}
class FakeText extends FakeNode {
  constructor(text) { super(); this._text = text; }
  get textContent() { return this._text; }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.checked = false;
    this.open = false;
    this.id = '';
    this.focused = false;
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  get firstChild() { return this.children[0] || null; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.children = []; this.appendChild(new FakeText(String(value))); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  focus() { this.focused = true; }
  fire(type, event = {}) { (this.listeners[type] || []).forEach((fn) => fn(event)); }
  find(predicate, out = []) {
    if (predicate(this)) out.push(this);
    this.children.forEach((c) => c.find && c.find(predicate, out));
    return out;
  }
}

function buildBrowser({ fetchImpl, language = 'en' }) {
  const elements = {};
  for (const m of html.matchAll(/\sid="([\w-]+)"/g)) {
    const el = new FakeElement('div');
    el.id = m[1];
    el.attributes.id = m[1];
    elements[m[1]] = el;
  }
  // elements that start hidden in the HTML
  for (const m of html.matchAll(/<(?:section|div|p)[^>]*\sid="([\w-]+)"[^>]*\shidden/g)) elements[m[1]].hidden = true;
  elements['use-ai'].checked = true;

  const i18nNodes = [...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => {
    const el = new FakeElement('span');
    el.attributes['data-i18n'] = m[1];
    return el;
  });
  const ariaNodes = [...html.matchAll(/data-i18n-aria="(\w+)"/g)].map((m) => {
    const el = new FakeElement('div');
    el.attributes['data-i18n-aria'] = m[1];
    return el;
  });

  const document = {
    readyState: 'complete',
    title: '',
    documentElement: new FakeElement('html'),
    // Like a real browser: also finds elements that scripts created later (e.g. the results heading).
    getElementById: (id) => {
      if (elements[id]) return elements[id];
      for (const root of Object.values(elements)) {
        const hit = root.find((e) => e.id === id);
        if (hit.length) return hit[0];
      }
      return null;
    },
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    querySelectorAll: (selector) => (selector === '[data-i18n]' ? i18nNodes : selector === '[data-i18n-aria]' ? ariaNodes : []),
    addEventListener() {},
  };

  const store = { ce_lang: language };
  const context = {
    document,
    Node: FakeNode,
    navigator: { language },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    fetch: fetchImpl,
    console,
    setTimeout,
    JSON,
  };
  context.window = context;
  context.window.scrollTo = () => {};
  vm.createContext(context);
  for (const file of ['i18n.js', 'dom.js', 'questionnaire.js', 'results.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'js', file), 'utf8'), context, { filename: file });
  }
  return { context, elements, document, CE: context.CE };
}

/** fetch() that calls the real route handlers (like Express would). */
function makeFetch({ gemini, config = { geminiModel: 'test-model' }, failNetwork = false, calls = [] }) {
  const content = scoring.loadContent();
  const explainer = new TemplateExplainer(content);
  const handlers = createHandlers({ content, explainer, gemini, config });
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (failNetwork) throw new TypeError('Failed to fetch');
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = (err) => errorHandler(err, {}, res, () => {});
    const req = { body: options.body ? JSON.parse(options.body) : undefined };
    if (url === '/api/health') handlers.health(req, res);
    else if (url === '/api/questions') handlers.questions(req, res);
    else if (url === '/api/careers') handlers.careers(req, res);
    else if (url === '/api/recommendations' && options.method === 'POST') await handlers.recommendations(req, res, next);
    else res.status(404).json({ error: { code: 'not_found', message: 'x' } });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.body };
  };
}

async function waitFor(condition, label) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`timed out waiting for: ${label}`);
}

function answerCurrentQuestion(b, value) {
  b.elements.options.fire('change', { target: { name: 'answer', value: String(value) } });
  b.elements['question-form'].fire('submit', { preventDefault() {} });
}

const noKey = () => createGeminiService({ apiKey: '', model: 'm', logger: { warn() {} } });
const textOf = (el) => el.textContent;

// ------------------------------------------------------------------- tests
test('FLOW: home -> 27 questions -> results (English), with no Gemini key', async () => {
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey() }) });
  const { CE, elements } = b;
  await waitFor(() => true);

  assert.equal(b.document.documentElement.lang, 'en');
  assert.equal(b.document.documentElement.dir, 'ltr');
  assert.equal(elements['ai-option'].hidden, true, 'AI option hidden when no key is configured');

  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess', 'assessment view');
  assert.equal(textOf(elements['progress-count']), 'Question 1 of 27');
  assert.ok(textOf(elements['question-text']).length > 10);
  assert.equal(elements.options.children.length, 5);

  // Submitting without choosing an answer shows a friendly hint and does not advance.
  elements['question-form'].fire('submit', { preventDefault() {} });
  assert.equal(elements['answer-hint'].hidden, false);
  assert.equal(CE.state.index, 0);

  const pattern = [5, 4, 5, 2, 3, 4, 5, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 5, 4, 3, 2, 5, 4, 3, 5, 4, 5];
  for (let i = 0; i < 27; i++) {
    assert.equal(textOf(elements['progress-count']), `Question ${i + 1} of 27`);
    assert.equal(textOf(elements['btn-next']), i === 26 ? 'See my results' : 'Next');
    answerCurrentQuestion(b, pattern[i]);
    if (i < 26) await waitFor(() => CE.state.index === i + 1, `question ${i + 2}`);
  }
  await waitFor(() => CE.state.view === 'results', 'results view');

  const page = textOf(elements['view-results']);
  assert.ok(page.includes('Your results'));
  assert.ok(page.includes('not a professional diagnosis'));
  assert.ok(page.includes('Compatibility score'));
  assert.ok(page.includes('Other fields worth exploring'));
  assert.ok(page.includes('Practical next steps'));
  assert.ok(page.includes('How this score was built'));
  assert.ok(page.includes('AI explanations are not set up on this server.'), 'fallback reason shown');
  assert.ok(!/undefined|NaN|\[object/.test(page), 'no broken values on the page');
  const fields = elements['view-results'].find((e) => e.className === 'field');
  assert.equal(fields.length, 3 + 4, '3 recommended + 4 alternatives');
  assert.ok(fields.every((f) => ['strong', 'moderate', 'exploratory'].includes(f.attributes['data-band'])));
  assert.equal(fields[0].open, true);
  const fills = elements['view-results'].find((e) => e.className === 'meter-fill');
  assert.ok(fills.every((f) => /^\d+%$/.test(f.style.width)));
  assert.equal(b.document.getElementById('results-title').focused, true, 'focus moves to the results heading');

  // Restart goes home and clears answers.
  const restart = elements['view-results'].find((e) => e.tagName === 'BUTTON' && textOf(e) === 'Start again')[0];
  restart.fire('click');
  assert.equal(CE.state.view, 'home');
  assert.equal(Object.keys(CE.state.answers).length, 0);
});

test('FLOW: switching to Arabic sets RTL, re-renders the question and re-fetches Arabic results', async () => {
  const calls = [];
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey(), calls }) });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');

  elements['lang-ar'].fire('click');
  assert.equal(b.document.documentElement.lang, 'ar');
  assert.equal(b.document.documentElement.dir, 'rtl');
  assert.equal(elements['lang-ar'].attributes['aria-pressed'], 'true');
  assert.equal(elements['lang-en'].attributes['aria-pressed'], 'false');
  assert.match(textOf(elements['progress-count']), /السؤال 1 من 27/);
  assert.match(textOf(elements['question-text']), /[\u0600-\u06FF]/);

  for (let i = 0; i < 27; i++) {
    answerCurrentQuestion(b, 4 + (i % 2));
    if (i < 26) await waitFor(() => CE.state.index === i + 1);
  }
  await waitFor(() => CE.state.view === 'results');
  let page = textOf(elements['view-results']);
  assert.match(page, /نتائجك/);
  assert.match(page, /هذه النتيجة أداة للاستكشاف/);
  const post = calls.filter((c) => c.url === '/api/recommendations').pop();
  assert.equal(JSON.parse(post.options.body).language, 'ar');

  // Switch back to English while on results: results are fetched again in English.
  elements['lang-en'].fire('click');
  await waitFor(() => CE.state.view === 'results' && /Your results/.test(textOf(elements['view-results'])), 'english results');
  assert.equal(b.document.documentElement.dir, 'ltr');
  assert.equal(JSON.parse(calls.filter((c) => c.url === '/api/recommendations').pop().options.body).language, 'en');
});

test('FLOW: Arabic is chosen automatically from the saved language', async () => {
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey() }), language: 'ar' });
  assert.equal(b.document.documentElement.dir, 'rtl');
});

test('FLOW: AI option appears when a key is configured, and AI text is shown when Gemini answers', async () => {
  const content = scoring.loadContent();
  const client = {
    models: {
      generateContent: async () => {
        // answer for whichever fields were requested in the prompt
        const ids = [...client.lastPrompt.matchAll(/"field_id": "(\w+)"/g)].map((m) => m[1]);
        return {
          text: JSON.stringify({
            overview: 'You rated several areas highly, so these fields may be worth exploring further.',
            fields: ids.map((id) => ({ field_id: id, why: 'Your answers show clear interest here, so it is a good one to explore.', practical_suggestions: ['Try a free beginner course.', 'Talk to someone who studies it.'] })),
          }),
        };
      },
    },
  };
  const original = client.models.generateContent;
  client.models.generateContent = async (args) => { client.lastPrompt = args.contents; return original(args); };
  const gemini = createGeminiService({ apiKey: 'x', model: 'fake-model', client, logger: { warn() {} } });
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini }) });
  const { CE, elements } = b;
  await waitFor(() => elements['ai-option'].hidden === false, 'AI option visible');

  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  for (let i = 0; i < 27; i++) {
    answerCurrentQuestion(b, i % 3 === 0 ? 5 : 4);
    if (i < 26) await waitFor(() => CE.state.index === i + 1);
  }
  await waitFor(() => CE.state.view === 'results');
  const page = textOf(elements['view-results']);
  assert.ok(page.includes('written with AI'));
  assert.ok(page.includes('Written by AI'));
  assert.ok(page.includes('Suggestions (written by AI)'));
  assert.ok(page.includes('You rated several areas highly'));
  assert.ok(!page.includes('AI explanations are not set up'));
  assert.ok(content); // content loaded fine
});

test('FLOW: unchecking the AI box sends useAI:false', async () => {
  const calls = [];
  const gemini = createGeminiService({ apiKey: 'x', model: 'm', client: { models: { generateContent: async () => ({ text: '{}' }) } }, logger: { warn() {} } });
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini, calls }) });
  const { CE, elements } = b;
  await waitFor(() => elements['ai-option'].hidden === false);
  elements['use-ai'].checked = false;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  for (let i = 0; i < 27; i++) {
    answerCurrentQuestion(b, 4);
    if (i < 26) await waitFor(() => CE.state.index === i + 1);
  }
  await waitFor(() => CE.state.view === 'results');
  assert.equal(JSON.parse(calls.filter((c) => c.url === '/api/recommendations').pop().options.body).useAI, false);
  assert.ok(textOf(elements['view-results']).includes('as you chose'));
});

test('FLOW: back button goes to the previous question and keeps earlier answers; first Back returns home', async () => {
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey() }) });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  answerCurrentQuestion(b, 5);
  await waitFor(() => CE.state.index === 1);
  elements['btn-back'].fire('click');
  assert.equal(CE.state.index, 0);
  assert.equal(CE.state.answers.q01, 5);
  const checked = elements.options.find((e) => e.tagName === 'INPUT' && e.checked);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].attributes.value, '5');
  elements['btn-back'].fire('click');
  assert.equal(CE.state.view, 'home');
});

test('FLOW: the 5 bipolar questions show anchors; agree questions do not', async () => {
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey() }) });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  const seen = { bipolar: 0, agree: 0 };
  for (let i = 0; i < 27; i++) {
    const hasAnchors = elements.anchors.hidden === false;
    const q = CE.state.questionsDoc.questions[CE.state.index];
    assert.equal(hasAnchors, q.type === 'bipolar', q.id);
    seen[q.type] += 1;
    if (i === 26) break;
    answerCurrentQuestion(b, 3);
    await waitFor(() => CE.state.index === i + 1);
  }
  assert.deepEqual(seen, { bipolar: 5, agree: 22 });
});

test('FLOW ERRORS: network failure shows a friendly message and a working retry', async () => {
  let fail = true;
  const content = scoring.loadContent();
  const ok = makeFetch({ gemini: noKey() });
  const fetchImpl = async (url, options) => {
    if (fail && url === '/api/recommendations') throw new TypeError('Failed to fetch');
    return ok(url, options);
  };
  const b = buildBrowser({ fetchImpl });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  for (let i = 0; i < 27; i++) {
    answerCurrentQuestion(b, 4);
    if (i < 26) await waitFor(() => CE.state.index === i + 1);
  }
  await waitFor(() => CE.state.view === 'error', 'error view');
  assert.match(textOf(elements['error-message']), /could not reach the server/);
  assert.equal(elements['btn-error-retry'].hidden, false);
  assert.ok(!/TypeError|Failed to fetch/.test(textOf(elements['error-message'])), 'raw error is not shown');

  fail = false;
  elements['btn-error-retry'].fire('click');
  await waitFor(() => CE.state.view === 'results', 'results after retry');
  assert.ok(content);
});

test('FLOW ERRORS: questions cannot be loaded -> friendly error, and "back to start" works', async () => {
  const b = buildBrowser({ fetchImpl: makeFetch({ gemini: noKey(), failNetwork: true }) });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'error');
  assert.match(textOf(elements['error-message']), /could not reach the server/);
  elements['btn-error-home'].fire('click');
  assert.equal(CE.state.view, 'home');
});

test('FLOW ERRORS: server answers 429 / 400 / 500 -> matching friendly messages', async () => {
  const ok = makeFetch({ gemini: noKey() });
  for (const [status, code, expected] of [[429, 'rate_limited', /too many requests/i], [400, 'invalid_request', /missing or not valid/], [500, 'server_error', /could not complete/]]) {
    const fetchImpl = async (url, options) => {
      if (url === '/api/recommendations') return { ok: false, status, json: async () => ({ error: { code, message: 'x' } }) };
      return ok(url, options);
    };
    const b = buildBrowser({ fetchImpl });
    const { CE, elements } = b;
    elements['btn-start'].fire('click');
    await waitFor(() => CE.state.view === 'assess');
    for (let i = 0; i < 27; i++) {
      answerCurrentQuestion(b, 4);
      if (i < 26) await waitFor(() => CE.state.index === i + 1);
    }
    await waitFor(() => CE.state.view === 'error');
    assert.match(textOf(elements['error-message']), expected, String(status));
  }
});

test('FLOW: text from the server is shown as text, never as HTML', async () => {
  const content = scoring.loadContent();
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const ok = makeFetch({ gemini: noKey() });
  const fetchImpl = async (url, options) => {
    const res = await ok(url, options);
    if (url !== '/api/recommendations') return res;
    const body = await res.json();
    body.recommended[0].name = hostile;
    body.recommended[0].explanation.text = hostile;
    return { ok: true, status: 200, json: async () => body };
  };
  const b = buildBrowser({ fetchImpl });
  const { CE, elements } = b;
  elements['btn-start'].fire('click');
  await waitFor(() => CE.state.view === 'assess');
  for (let i = 0; i < 27; i++) {
    answerCurrentQuestion(b, 4);
    if (i < 26) await waitFor(() => CE.state.index === i + 1);
  }
  await waitFor(() => CE.state.view === 'results');
  assert.ok(textOf(elements['view-results']).includes(hostile), 'shown literally as text');
  assert.equal(elements['view-results'].find((e) => e.tagName === 'IMG' || e.tagName === 'SCRIPT').length, 0, 'no element was created from it');
  assert.ok(content);
});
