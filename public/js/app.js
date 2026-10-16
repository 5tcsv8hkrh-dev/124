/*
 * app.js - starts the app and connects the pieces:
 *   language switcher, switching between screens, and talking to the backend API.
 *
 * The browser only ever talks to OUR server (/api/...). The Gemini key never reaches the browser.
 */
(function () {
  'use strict';

  var CE = window.CE;
  var VIEWS = ['home', 'assess', 'loading', 'results', 'error'];
  // Default for the "Use AI-written explanations" checkbox. The student can switch it off.
  var DEFAULT_USE_AI = true;

  var state = (CE.state = {
    lang: 'en',
    questionsDoc: null,
    answers: {},
    index: 0,
    view: 'home',
    aiConfigured: false,
    retry: null,
    lastError: null
  });

  function $(id) { return document.getElementById(id); }
  function t(key, params) { return CE.i18n.t(state.lang, key, params); }

  // ---------------------------------------------------------- language
  function applyLanguage(lang) {
    state.lang = lang === 'ar' ? 'ar' : 'en';
    var root = document.documentElement;
    root.lang = state.lang;
    root.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('doc_title');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    $('lang-en').setAttribute('aria-pressed', String(state.lang === 'en'));
    $('lang-ar').setAttribute('aria-pressed', String(state.lang === 'ar'));
    $('progress-track').setAttribute('aria-label', t('progress_label'));
    try { localStorage.setItem('ce_lang', state.lang); } catch (e) { /* storage may be blocked: ignore */ }
  }

  function setLanguage(lang) {
    if (lang === state.lang) return;
    applyLanguage(lang);
    if (state.view === 'assess') CE.questionnaire.render(false);
    else if (state.view === 'results') fetchResults(); // AI text is language-specific: ask again
    else if (state.view === 'error') showError(state.lastError, state.retry);
  }

  // ------------------------------------------------------------- views
  function showView(name, focusId) {
    state.view = name;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
    var focusTarget = focusId && $(focusId);
    if (focusTarget) focusTarget.focus();
  }

  function showError(err, retry) {
    state.lastError = err;
    state.retry = retry || null;
    var code = err && err.code;
    var key = 'error_generic';
    if (code === 'network') key = 'error_network';
    else if (code === 'rate_limited') key = 'error_rate_limited';
    else if (code === 'invalid_request') key = 'error_invalid';
    else if (code === 'questions') key = 'error_questions';
    $('error-message').textContent = t(key);
    $('btn-error-retry').hidden = !retry;
    showView('error', 'error-title');
  }

  // --------------------------------------------------------------- API
  /** Call our backend. Throws { code } with a short code on any failure. */
  async function api(path, options) {
    var response;
    try {
      response = await fetch(path, options);
    } catch (e) {
      throw { code: 'network' };
    }
    var body = null;
    try { body = await response.json(); } catch (e) { /* not JSON */ }
    if (!response.ok) {
      var code = body && body.error && body.error.code;
      if (!code && response.status === 429) code = 'rate_limited';
      throw { code: code || 'server_error', status: response.status };
    }
    return body;
  }

  async function loadQuestions() {
    if (state.questionsDoc) return;
    try {
      state.questionsDoc = await api('/api/questions');
    } catch (err) {
      throw { code: err.code === 'network' ? 'network' : 'questions' };
    }
  }

  async function start() {
    showView('loading', 'loading-title');
    $('loading-title').textContent = t('loading_questions');
    try {
      await loadQuestions();
    } catch (err) {
      $('loading-title').textContent = t('loading_title');
      showError(err, start);
      return;
    }
    $('loading-title').textContent = t('loading_title');
    state.answers = {};
    state.index = 0;
    showView('assess');
    CE.questionnaire.render(true);
  }

  function wantAi() {
    // If the server has no key, ask anyway: the server replies with a clear "not set up" reason.
    return state.aiConfigured ? $('use-ai').checked : true;
  }

  async function fetchResults() {
    showView('loading', 'loading-title');
    $('loading-title').textContent = t('loading_title');
    try {
      var data = await api('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: state.answers, language: state.lang, useAI: wantAi() })
      });
      CE.results.render(data);
      showView('results', 'results-title');
    } catch (err) {
      showError(err, fetchResults);
    }
  }

  function restart() {
    state.answers = {};
    state.index = 0;
    showView('home', 'home-title');
  }

  // -------------------------------------------------------------- init
  async function checkHealth() {
    try {
      var health = await api('/api/health');
      state.aiConfigured = Boolean(health.ai && health.ai.configured);
      $('use-ai').checked = DEFAULT_USE_AI;
      $('ai-option').hidden = !state.aiConfigured;
    } catch (e) {
      state.aiConfigured = false; // the home page still works; errors appear when the API is needed
    }
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem('ce_lang'); } catch (e) { /* ignore */ }
    var preferred = saved || ((navigator.language || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en');
    applyLanguage(preferred);

    $('lang-en').addEventListener('click', function () { setLanguage('en'); });
    $('lang-ar').addEventListener('click', function () { setLanguage('ar'); });
    $('btn-start').addEventListener('click', start);
    $('brand-link').addEventListener('click', function (event) { event.preventDefault(); restart(); });
    $('btn-error-home').addEventListener('click', restart);
    $('btn-error-retry').addEventListener('click', function () { if (state.retry) state.retry(); });

    CE.questionnaire.init();
    CE.questionnaire.onExit = restart;
    CE.questionnaire.onFinish = function () {
      if (CE.questionnaire.isComplete()) fetchResults();
    };
    CE.results.onRestart = restart;

    checkHealth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
