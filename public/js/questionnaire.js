/*
 * questionnaire.js - shows one question at a time with a progress track.
 *
 * Answers live only in memory (CE.state.answers). Nothing is saved in the browser or sent
 * anywhere until the student finishes and the app asks for results.
 */
(function () {
  'use strict';

  var CE = window.CE;
  var h = CE.dom.h;
  var clear = CE.dom.clear;

  function $(id) { return document.getElementById(id); }
  function t(key, params) { return CE.i18n.t(CE.state.lang, key, params); }

  /** Groups in the order they first appear, with how many questions each has. */
  function groupSizes(doc) {
    var order = [];
    var sizes = {};
    doc.questions.forEach(function (q) {
      if (!(q.group in sizes)) { sizes[q.group] = 0; order.push(q.group); }
      sizes[q.group] += 1;
    });
    return { order: order, sizes: sizes };
  }

  function renderTrack(doc, question) {
    var info = groupSizes(doc);
    var track = $('progress-track');
    clear(track);
    var answeredTotal = 0;
    info.order.forEach(function (group) {
      var answered = doc.questions.filter(function (q) {
        return q.group === group && CE.state.answers[q.id] !== undefined;
      }).length;
      answeredTotal += answered;
      var fill = h('span', { class: 'seg-fill' });
      fill.style.width = Math.round((answered / info.sizes[group]) * 100) + '%';
      var seg = h('div', { class: 'seg' + (group === question.group ? ' current' : '') }, fill);
      seg.style.flex = String(info.sizes[group]); // wider segment = more questions
      track.appendChild(seg);
    });
    track.setAttribute('aria-valuenow', String(answeredTotal));
    track.setAttribute('aria-valuemax', String(doc.questions.length));
  }

  function optionLabel(question, value, lang) {
    var doc = CE.state.questionsDoc;
    if (question.type === 'bipolar') {
      return {
        full: t('bipolar_' + value, { low: question['low_' + lang], high: question['high_' + lang] }),
        visible: value === 3 ? t('in_between') : ''
      };
    }
    var text = doc.scale['agree_labels_' + lang][value - 1];
    return { full: text, visible: text };
  }

  function render(moveFocus) {
    var state = CE.state;
    var doc = state.questionsDoc;
    var lang = state.lang;
    var q = doc.questions[state.index];
    var total = doc.questions.length;

    $('progress-count').textContent = t('progress_count', { n: state.index + 1, total: total });
    $('progress-group').textContent = doc.groups[q.group]['title_' + lang];
    renderTrack(doc, q);

    var legend = $('question-text');
    legend.textContent = q['text_' + lang];
    legend.setAttribute('tabindex', '-1');

    $('scale-hint').textContent = t(q.type === 'bipolar' ? 'scale_hint_bipolar' : 'scale_hint_agree');

    var anchors = $('anchors');
    if (q.type === 'bipolar') {
      $('anchor-low').textContent = q['low_' + lang];
      $('anchor-high').textContent = q['high_' + lang];
      anchors.hidden = false;
    } else {
      anchors.hidden = true;
    }

    var options = $('options');
    clear(options);
    for (var value = 1; value <= doc.scale.max; value++) {
      var label = optionLabel(q, value, lang);
      var input = h('input', { attrs: { type: 'radio', name: 'answer', value: String(value) } });
      if (state.answers[q.id] === value) input.checked = true;
      var box = h('span', { class: 'option-box' },
        h('span', { class: 'option-num', attrs: { 'aria-hidden': 'true' } }, String(value)),
        label.visible ? h('span', { class: 'option-text', attrs: { 'aria-hidden': 'true' } }, label.visible) : null,
        h('span', { class: 'sr-only' }, String(value) + ' - ' + label.full)
      );
      options.appendChild(h('label', { class: 'option' }, input, box));
    }

    $('answer-hint').hidden = true;
    $('btn-next').textContent = t(state.index === total - 1 ? 'finish' : 'next');
    if (moveFocus) legend.focus();
  }

  function onChange(event) {
    if (event.target && event.target.name === 'answer') {
      var q = CE.state.questionsDoc.questions[CE.state.index];
      CE.state.answers[q.id] = Number(event.target.value);
      $('answer-hint').hidden = true;
      renderTrack(CE.state.questionsDoc, q);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    var state = CE.state;
    var q = state.questionsDoc.questions[state.index];
    if (state.answers[q.id] === undefined) {
      var hint = $('answer-hint');
      hint.textContent = t('answer_required');
      hint.hidden = false;
      return;
    }
    if (state.index < state.questionsDoc.questions.length - 1) {
      state.index += 1;
      render(true);
    } else if (api.onFinish) {
      api.onFinish();
    }
  }

  function onBack() {
    if (CE.state.index > 0) {
      CE.state.index -= 1;
      render(true);
    } else if (api.onExit) {
      api.onExit();
    }
  }

  function init() {
    $('question-form').addEventListener('submit', onSubmit);
    $('options').addEventListener('change', onChange);
    $('btn-back').addEventListener('click', onBack);
  }

  /** True when every question has an answer. */
  function isComplete() {
    var doc = CE.state.questionsDoc;
    return Boolean(doc) && doc.questions.every(function (q) { return CE.state.answers[q.id] !== undefined; });
  }

  var api = { init: init, render: render, isComplete: isComplete, onFinish: null, onExit: null };
  CE.questionnaire = api;
})();
