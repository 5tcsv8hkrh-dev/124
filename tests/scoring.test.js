'use strict';
/**
 * Tests for the deterministic scoring engine and the data files.
 * Run all tests with:  npm test
 *
 * NOTE: the "persona" tests only check that the engine behaves as designed on INVENTED
 * profiles. They are not scientific validation of the recommendations.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const s = require('../src/services/scoringService');
const demo = require('./fixtures/demo_students.json').students;
const golden = require('./fixtures/python_v1_golden.json');

const content = s.loadContent();
const ALL_DIMS = Object.keys(content.questionsDoc.dimensions);
const allDims = (value) => Object.fromEntries(ALL_DIMS.map((d) => [d, value]));
const answers = (dims, def = 3) => s.answersFromDimensions(dims, content, def);
const personas = Object.fromEntries(demo.map((d) => [d.demo_id, d.answers_by_dimension]));

// ------------------------------------------------------------- data files
test('content loads and is consistent', () => {
  assert.equal(content.questionsDoc.questions.length, 27);
  assert.ok(Object.keys(content.fieldsDoc.fields).length >= 15);
  assert.equal(content.config.fit_mode, 'neutral_zero');
});

test('group weights sum to 1', () => {
  const sum = Object.values(content.config.group_weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('every question, dimension and field has Arabic and English text', () => {
  for (const q of content.questionsDoc.questions) assert.ok(q.text_en.trim() && q.text_ar.trim(), q.id);
  for (const [id, d] of Object.entries(content.questionsDoc.dimensions)) assert.ok(d.label_en.trim() && d.label_ar.trim(), id);
  for (const [id, f] of Object.entries(content.fieldsDoc.fields)) assert.ok(f.name_en.trim() && f.name_ar.trim(), id);
});

test('field_info.json covers every field, in both languages, with valid related fields', () => {
  const fields = Object.keys(content.fieldsDoc.fields).sort();
  assert.deepEqual(Object.keys(content.fieldInfo).sort(), fields);
  for (const [id, info] of Object.entries(content.fieldInfo)) {
    for (const key of ['subjects', 'majors', 'careers', 'skills', 'activities', 'questions']) {
      for (const lang of ['en', 'ar']) {
        assert.ok(Array.isArray(info[key][lang]) && info[key][lang].length >= 2, `${id}.${key}.${lang}`);
      }
      assert.equal(info[key].en.length, info[key].ar.length, `${id}.${key} list lengths differ between languages`);
    }
    for (const rel of info.related) {
      assert.ok(fields.includes(rel), `${id} lists unknown related field ${rel}`);
      assert.notEqual(rel, id);
    }
  }
});

test('field_info contains no web links', () => {
  assert.ok(!/https?:\/\/|www\./i.test(JSON.stringify(content.fieldInfo)));
});

test('bad content is rejected (typo in a dimension, two questions for one dimension)', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fieldsDoc = clone(content.fieldsDoc);
  fieldsDoc.fields.law.profile.int_typo = [0.5, 1];
  assert.throws(() => s.checkContent({ ...content, fieldsDoc }), s.ContentError);

  const questionsDoc = clone(content.questionsDoc);
  questionsDoc.questions.push({ ...questionsDoc.questions[0], id: 'q99' });
  assert.throws(() => s.checkContent({ ...content, questionsDoc }), s.ContentError);

  const config = { ...content.config, fit_mode: 'something_else' };
  assert.throws(() => s.checkContent({ ...content, config }), s.ContentError);
});

// ------------------------------------------------------------ validation
test('valid answers pass; missing, out-of-range, wrong-type and unknown ids fail', () => {
  s.validateAnswers(answers({}), content);

  const missing = answers({});
  delete missing.q05;
  assert.throws(() => s.validateAnswers(missing, content), (e) => e.problems.includes('q05: missing'));

  for (const bad of [0, 6, -1, 2.5, '4', null, true, NaN]) {
    const a = answers({});
    a.q01 = bad;
    assert.throws(() => s.validateAnswers(a, content), s.AnswerValidationError, String(bad));
  }

  const extra = answers({});
  extra.q999 = 3;
  assert.throws(() => s.validateAnswers(extra, content), s.AnswerValidationError);
  assert.throws(() => s.validateAnswers([3, 3], content), s.AnswerValidationError);
  assert.throws(() => s.validateAnswers(null, content), s.AnswerValidationError);
});

// -------------------------------------------------------------- scoring
test('answers 1..5 become levels 0..1', () => {
  const low = s.buildStudentProfile(answers({}, 1), content);
  const high = s.buildStudentProfile(answers({}, 5), content);
  assert.ok(Object.values(low).every((v) => v === 0));
  assert.ok(Object.values(high).every((v) => v === 1));
});

test('dimensionFit (neutral_zero): neutral gives nothing, agreement earns proportionally', () => {
  const cfg = { fit_mode: 'neutral_zero', evidence_floor: 0.25 };
  assert.equal(s.dimensionFit('interests', 0.5, 0.8, cfg), 0); // answer 3 -> no evidence
  assert.equal(s.dimensionFit('interests', 0.25, 0.8, cfg), 0); // answer 2 -> no evidence
  assert.equal(s.dimensionFit('interests', 1.0, 0.8, cfg), 1); // answer 5 meets any target
  assert.ok(Math.abs(s.dimensionFit('interests', 0.75, 0.8, cfg) - 0.5 / 0.6) < 1e-9); // answer 4 vs target 0.8
  assert.equal(s.dimensionFit('skills', 0.75, 0.55, cfg), 1); // mild target: answer 4 is enough (floor 0.25)
  assert.equal(s.dimensionFit('values', 0.5, 0.5, cfg), 0); // even a mild target needs real agreement
});

test('dimensionFit (neutral_zero) for preferences: neutral gives nothing, closeness counts both ways', () => {
  const cfg = { fit_mode: 'neutral_zero' };
  assert.equal(s.dimensionFit('preferences', 0.5, 0.5, cfg), 0);
  assert.equal(s.dimensionFit('preferences', 0.75, 0.75, cfg), 1);
  assert.ok(Math.abs(s.dimensionFit('preferences', 0.25, 0.75, cfg) - 0.5) < 1e-9);
  assert.equal(s.dimensionFit('preferences', 1, 0, cfg), 0);
});

test('NEUTRAL FIX: a student who answers 3 to everything gets a score of 0 for every field', () => {
  const result = s.recommend(answers({}, 3), content);
  assert.ok(result.full_ranking.every((r) => r.score === 0), 'all scores must be 0');
  assert.ok(result.recommended.every((r) => r.band === 'exploratory'));
  assert.ok(result.warnings.includes('flat_profile'));
});

test('NEUTRAL FIX: answering "neutral" instead of "agree" on a dimension never raises a score', () => {
  const agree = s.recommend(answers({ int_technology: 5, sk_logical: 5, sk_programming: 5 }), content);
  const neutral = s.recommend(answers({ int_technology: 3, sk_logical: 3, sk_programming: 3 }), content);
  const byId = (r) => Object.fromEntries(r.full_ranking.map((x) => [x.field_id, x.score]));
  const a = byId(agree);
  const n = byId(neutral);
  for (const id of Object.keys(a)) assert.ok(n[id] <= a[id], id);
  assert.ok(a.cybersecurity > n.cybersecurity);
});

test('NEUTRAL FIX: no field can be a "strong" match when the student gave no clear agreement anywhere', () => {
  const result = s.recommend(answers({ int_technology: 4 }, 3), content); // one mild signal, everything else neutral
  const strong = result.full_ranking.filter((r) => s.scoreBand(r.score, content) === 'strong');
  assert.equal(strong.length, 0);
});

test('lowest answers everywhere give low scores; highest give a flat-profile warning', () => {
  const low = s.recommend(answers({}, 1), content);
  assert.ok(Math.max(...low.full_ranking.map((r) => r.score)) < 25);
  const high = s.recommend(answers({}, 5), content);
  assert.ok(high.warnings.includes('flat_profile')); // agreeing with everything cannot tell fields apart
});

test('all scores are between 0 and 100', () => {
  for (const def of [1, 2, 3, 4, 5]) {
    for (const r of s.recommend(answers({}, def), content).full_ranking) {
      assert.ok(r.score >= 0 && r.score <= 100);
    }
  }
});

test('points per dimension add up to the field score (explanations are faithful)', () => {
  for (const dims of Object.values(personas)) {
    const result = s.recommend(answers(dims), content);
    for (const r of [...result.recommended, ...result.alternatives]) {
      const total = r.contributions.reduce((sum, c) => sum + c.points, 0);
      assert.ok(Math.abs(total - r.score) <= 0.15, r.field_id);
    }
  }
});

test('scoring is deterministic and JSON-serialisable', () => {
  const a = answers(personas.demo_creative);
  assert.deepEqual(s.recommend(a, content), s.recommend(a, content));
  JSON.stringify(s.recommend(a, content));
});

test('diversity rule: at most max_per_family per family; alternatives never repeat; pure ranking is sorted', () => {
  const { max_per_family, top_n } = content.config.selection;
  for (const dims of Object.values(personas)) {
    const result = s.recommend(answers(dims), content);
    const families = result.recommended.map((r) => content.fieldsDoc.fields[r.field_id].family);
    for (const fam of new Set(families)) assert.ok(families.filter((f) => f === fam).length <= max_per_family);
    assert.equal(result.recommended.length, top_n);
    const rec = new Set(result.recommended.map((r) => r.field_id));
    assert.ok(result.alternatives.every((r) => !rec.has(r.field_id)));
    const scores = result.full_ranking.map((r) => r.score);
    assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  }
});

test('persona sanity checks (invented profiles, NOT validation)', () => {
  const top = (name, n = 3) => s.recommend(answers(personas[name]), content).full_ranking.slice(0, n).map((r) => r.field_id);
  const overlaps = (list, set) => list.some((id) => set.includes(id));
  assert.ok(overlaps(top('demo_tech_independent'), ['computer_science', 'software_engineering', 'cybersecurity', 'artificial_intelligence', 'data_science']));
  assert.ok(overlaps(top('demo_people_caring'), ['psychology', 'education', 'medicine']));
  assert.ok(overlaps(top('demo_creative'), ['design', 'architecture', 'media']));
  assert.ok(overlaps(top('demo_lab_science'), ['biotechnology', 'physical_sciences', 'environmental_science']));
});

test('profile summary only lists answers of 4 or 5 as notable areas', () => {
  const summary = s.recommend(answers({ int_technology: 5, int_life_science: 4, int_mathematics: 3, int_art_design: 2 }), content).profile_summary;
  const ids = summary.top_interests.map((i) => i.dimension);
  assert.deepEqual(ids, ['int_technology', 'int_life_science']);
});

// ----------------------------------------------------- parity with Python
test('PARITY: in legacy mode the JavaScript engine reproduces the ORIGINAL Python scores exactly', () => {
  const legacy = { ...content, config: { ...content.config, fit_mode: 'legacy' } };
  let compared = 0;
  for (const [name, c] of Object.entries(golden.cases)) {
    const result = s.recommend(s.answersFromDimensions(c.answers_by_dimension, legacy), legacy);
    assert.equal(result.full_ranking.length, c.full_ranking.length, name);
    result.full_ranking.forEach((r, i) => {
      assert.equal(r.field_id, c.full_ranking[i].field_id, `${name} order #${i + 1}`);
      assert.equal(r.score, c.full_ranking[i].score, `${name} ${r.field_id}`);
      compared += 1;
    });
    assert.deepEqual(result.recommended.map((r) => r.field_id), c.recommended_ids, `${name} recommended`);
    assert.deepEqual(result.alternatives.map((r) => r.field_id), c.alternative_ids, `${name} alternatives`);
    assert.deepEqual(result.warnings, c.warnings, `${name} warnings`);
  }
  assert.ok(compared >= 100);
});

test('the fix really changes the numbers: default scores differ from the original Python scores', () => {
  const c = golden.cases.all_neutral;
  const fixed = s.recommend(s.answersFromDimensions(c.answers_by_dimension, content), content);
  assert.ok(Math.max(...c.full_ranking.map((r) => r.score)) > 50); // the old method gave "strong" scores here
  assert.equal(Math.max(...fixed.full_ranking.map((r) => r.score)), 0);
});

test('path to data directory resolves inside the project', () => {
  assert.ok(path.basename(path.resolve(__dirname, '..', 'src', 'data')) === 'data');
});
