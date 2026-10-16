/*
 * results.js - builds the results page from the JSON returned by POST /api/recommendations.
 * All text is inserted as text (never as HTML) by the helper in dom.js.
 */
(function () {
  'use strict';

  var CE = window.CE;
  var h = CE.dom.h;
  var clear = CE.dom.clear;

  function t(key, params) { return CE.i18n.t(CE.state.lang, key, params); }

  function listSeparator() { return CE.state.lang === 'ar' ? '، ' : ', '; }

  function chips(items, extraClass) {
    return h('ul', { class: 'chips' }, items.map(function (text) {
      return h('li', { class: 'chip' + (extraClass ? ' ' + extraClass : '') }, text);
    }));
  }

  function bulletList(items) {
    return h('ul', {}, items.map(function (text) { return h('li', {}, text); }));
  }

  function stepsBlock(titleKey, items) {
    if (!items || !items.length) return null;
    return h('div', {}, h('h5', {}, t(titleKey)), bulletList(items));
  }

  // ------------------------------------------------------------ one field
  function scoreBlock(field, data) {
    var score = Math.round(field.score);
    var meterLabel = t('score_meter_label', { label: data.labels.score_label, score: score });
    var fill = h('span', { class: 'meter-fill' });
    fill.style.width = Math.max(0, Math.min(100, score)) + '%';
    return h('div', { class: 'score' },
      h('div', { class: 'score-line' },
        h('span', {}, data.labels.score_label),
        h('strong', {}, t('score_out_of', { score: score }))
      ),
      h('div', { class: 'meter', attrs: { role: 'img', 'aria-label': meterLabel } }, fill)
    );
  }

  function fieldItem(field, data, options) {
    var details = h('details', { class: 'field', attrs: { 'data-band': field.band } });
    if (options.open) details.open = true;

    var title = h('span', { class: 'field-name' },
      field.rank ? h('span', { class: 'field-rank' }, String(field.rank) + '.') : null,
      field.name,
      h('span', { class: 'field-band' }, field.band_label)
    );
    details.appendChild(h('summary', {}, title, scoreBlock(field, data)));

    var body = h('div', { class: 'field-body' });

    // Be open about the diversity rule: show when a field's pure score rank is lower.
    if (field.rank && field.overall_rank > field.rank) {
      body.appendChild(h('p', { class: 'note' }, t('pure_rank_note', { n: field.overall_rank })));
    }

    // Why it appeared
    var isAi = field.explanation.source === 'ai';
    body.appendChild(h('div', {},
      h('h4', {}, t('why_title'), h('span', { class: 'badge' }, t(isAi ? 'badge_ai' : 'badge_template'))),
      h('p', {}, field.explanation.text)
    ));

    if (field.explanation.strengths.length) {
      body.appendChild(h('div', {}, h('h4', {}, t('matched_title')), chips(field.explanation.strengths)));
    }
    if (field.explanation.points_to_check.length) {
      body.appendChild(h('div', {}, h('h4', {}, t('check_title')), chips(field.explanation.points_to_check, 'check-chip')));
    }

    if (field.ai_suggestions && field.ai_suggestions.length) {
      body.appendChild(h('div', {}, h('h4', {}, t('ai_suggestions_title')), bulletList(field.ai_suggestions)));
    }

    // Transparency: exactly which answers added points.
    if (field.contributions.length) {
      body.appendChild(h('details', { class: 'built' },
        h('summary', {}, t('built_title')),
        bulletList(field.contributions.map(function (c) {
          return t('built_item', { label: c.label, answer: c.answer, points: c.points.toFixed(1) });
        }))
      ));
    }

    // Practical next steps
    var s = field.next_steps;
    if (s) {
      body.appendChild(h('div', {},
        h('h4', {}, t('next_steps_title')),
        h('div', { class: 'steps' },
          stepsBlock('steps_subjects', s.subjects),
          stepsBlock('steps_majors', s.majors),
          stepsBlock('steps_careers', s.careers),
          stepsBlock('steps_skills', s.skills),
          stepsBlock('steps_activities', s.activities),
          stepsBlock('steps_questions', s.questions)
        )
      ));
    }

    if (field.related && field.related.length) {
      body.appendChild(h('div', {}, h('h4', {}, t('related_title')),
        chips(field.related.map(function (r) { return r.name; }))));
    }

    details.appendChild(body);
    return details;
  }

  // ----------------------------------------------------------- whole page
  function areasSection(data) {
    var rows = [
      ['areas_interests', data.profile.interests],
      ['areas_skills', data.profile.skills],
      ['areas_preferences', data.profile.preferences],
      ['areas_values', data.profile.values],
      ['areas_learning', data.profile.learning]
    ].filter(function (row) { return row[1] && row[1].length; });

    var content;
    if (rows.length === 0) {
      content = h('p', { class: 'muted' }, t('areas_none'));
    } else {
      content = h('dl', { class: 'areas' }, rows.map(function (row) {
        return h('div', {}, h('dt', {}, t(row[0])), h('dd', {}, row[1].join(listSeparator())));
      }));
    }
    return h('section', { attrs: { 'aria-labelledby': 'areas-title' } }, h('h3', { attrs: { id: 'areas-title' } }, t('areas_title')), content);
  }

  function aiStatusText(ai) {
    if (ai.status === 'used') return t('ai_status_used');
    if (ai.status === 'disabled') return t('ai_status_disabled');
    var reasonKey = 'ai_reason_' + (ai.reason || 'unavailable');
    var reason = CE.i18n.STRINGS.en[reasonKey] ? t(reasonKey) : t('ai_reason_unavailable');
    return t('ai_status_fallback', { reason: reason });
  }

  function render(data) {
    var root = document.getElementById('view-results');
    clear(root);

    var recommendedList = h('ol', { class: 'field-list' }, data.recommended.map(function (f, i) {
      return h('li', {}, fieldItem(f, data, { open: i === 0 }));
    }));
    var alternativesList = h('ul', { class: 'field-list' }, data.alternatives.map(function (f) {
      return h('li', {}, fieldItem(f, data, { open: false }));
    }));

    var restart = h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: function () { if (api.onRestart) api.onRestart(); } } }, t('restart'));

    root.appendChild(h('div', { class: 'wrap' },
      h('header', { class: 'results-head' },
        h('h2', { attrs: { id: 'results-title', tabindex: '-1' } }, t('results_title')),
        h('p', { class: 'lead' }, t('results_lead')),
        h('p', { class: 'disclaimer' }, data.labels.disclaimer),
        h('p', { class: 'ai-status' }, aiStatusText(data.meta.ai)),
        data.warnings.map(function (w) { return h('p', { class: 'warning', attrs: { role: 'note' } }, w.text); })
      ),
      areasSection(data),
      h('section', { attrs: { 'aria-labelledby': 'recommended-title' } },
        h('h3', { class: 'section-title', attrs: { id: 'recommended-title' } }, t('recommended_title')),
        h('p', { class: 'muted small' }, data.labels.score_note),
        data.ai_overview
          ? h('div', { class: 'overview' }, h('h4', {}, t('ai_overview_title'), h('span', { class: 'badge' }, t('badge_ai'))), h('p', {}, data.ai_overview))
          : null,
        recommendedList
      ),
      h('section', { attrs: { 'aria-labelledby': 'alt-title' } },
        h('h3', { class: 'section-title', attrs: { id: 'alt-title' } }, t('alt_title')),
        h('p', { class: 'muted' }, t('alt_intro')),
        alternativesList
      ),
      h('p', { class: 'muted small' }, t('score_method_note')),
      h('div', { class: 'results-actions' }, restart)
    ));
  }

  var api = { render: render, onRestart: null };
  CE.results = api;
})();
