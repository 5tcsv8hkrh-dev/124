'use strict';
/**
 * scoringService.js - the transparent, rule-based scoring engine.
 *
 * This file does NOT use the web server, a database or Gemini. It only reads
 * the JSON files in src/data and does arithmetic, so every number can be
 * checked by hand and the tests can run without internet.
 *
 * HOW THE SCORE IS CALCULATED
 * 1. Each answer (1-5) becomes a level from 0 to 1:  (answer - 1) / 4
 *    Each dimension (e.g. "interest in technology") has exactly one question.
 * 2. Each field has a profile: for some dimensions a TARGET (0-1) and a WEIGHT
 *    (importance 1-3). Example: Cybersecurity wants int_technology target 0.8, weight 3.
 * 3. For each dimension we compute a FIT from 0 to 1.
 *
 *    METHOD v0.2 ("neutral_zero", the default):
 *      A NEUTRAL answer (3) gives NO positive evidence, so its fit is 0 on every
 *      dimension. Only real agreement earns points.
 *      - interests / skills / values / learning ("more is fine"):
 *            evidence       = max(0, (level - 0.5) / 0.5)        (answer 3 -> 0, 4 -> 0.5, 5 -> 1)
 *            targetEvidence = clamp((target - 0.5) / 0.5, floor, 1)
 *            fit            = min(1, evidence / targetEvidence)
 *      - preferences ("being close matters", e.g. team vs. independent):
 *            fit = 1 - |level - target|        (but 0 if the answer is neutral)
 *
 *    METHOD v0.1 ("legacy", kept ONLY to compare with the old Python version):
 *            more-is-fine:   fit = min(1, level / target)
 *            preferences:    fit = 1 - |level - target|
 *      Under v0.1 a student who answered "neutral" to everything still received
 *      "strong" matches. That is why v0.2 exists. See docs/SCORING_CHANGELOG.md.
 *
 * 4. Fits are averaged (weighted by importance) inside each group, then groups are
 *    combined with the group weights in scoring_config.json. Every dimension adds a
 *    known number of POINTS and the points add up exactly to the final score.
 *    The explanation layer uses these points to say WHY a field was suggested.
 *
 * The result is a compatibility score, NOT a probability and NOT a measure of
 * ability or future success.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const TWO_SIDED_GROUPS = new Set(['preferences']);

class ContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentError';
  }
}

class AnswerValidationError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.name = 'AnswerValidationError';
    this.problems = problems;
  }
}

// ---------------------------------------------------------------- helpers
/**
 * Round to `digits` decimals (digits >= 1), exactly like Python's round():
 * the exact stored value of the number decides, and an exact tie (e.g. 3.125)
 * is rounded to the even digit. This keeps results identical to the original
 * Python version when fit_mode is 'legacy'.
 */
function round(value, digits) {
  const wide = Math.abs(value).toFixed(digits + 25);
  const cut = wide.length - 25;
  const head = wide.slice(0, cut);
  const tail = wide.slice(cut);
  if (/^50*$/.test(tail)) {
    const down = Number(head);
    const lastDigit = Number(head[head.length - 1]);
    const result = lastDigit % 2 === 0 ? down : Number((down + 10 ** -digits).toFixed(digits));
    return value < 0 ? -result : result;
  }
  return Number(value.toFixed(digits));
}

/**
 * Add numbers with compensated (Neumaier) summation. Python 3.12's built-in sum()
 * does this, so using it here keeps tie-rounding identical to the original version.
 */
function sumPrecise(values) {
  let sum = 0;
  let compensation = 0;
  for (const x of values) {
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) compensation += sum - t + x;
    else compensation += x - t + sum;
    sum = t;
  }
  return sum + compensation;
}

function pstdev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// --------------------------------------------------------- loading content
/** Load questions.json, fields.json and scoring_config.json and check they fit together. */
function loadContent(dataDir = DEFAULT_DATA_DIR) {
  const content = {
    questionsDoc: readJson(path.join(dataDir, 'questions.json')),
    fieldsDoc: readJson(path.join(dataDir, 'fields.json')),
    config: readJson(path.join(dataDir, 'scoring_config.json')),
    fieldInfo: fs.existsSync(path.join(dataDir, 'field_info.json'))
      ? readJson(path.join(dataDir, 'field_info.json')).fields
      : {},
  };
  checkContent(content);
  return content;
}

/** Throw ContentError if the JSON files do not fit together (catches typos early). */
function checkContent(content) {
  const dims = content.questionsDoc.dimensions;
  const groupWeights = content.config.group_weights;
  const questions = content.questionsDoc.questions;

  for (const [dimId, dim] of Object.entries(dims)) {
    if (!(dim.group in groupWeights)) {
      throw new ContentError(`Dimension '${dimId}' has unknown group '${dim.group}'`);
    }
    if (TWO_SIDED_GROUPS.has(dim.group)) {
      for (const k of ['low_en', 'low_ar', 'high_en', 'high_ar']) {
        if (!dim[k]) throw new ContentError(`Preference dimension '${dimId}' needs '${k}'`);
      }
    }
  }

  const ids = questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) throw new ContentError('Duplicate question ids');

  const perDim = {};
  for (const q of questions) {
    if (!(q.dimension in dims)) {
      throw new ContentError(`Question ${q.id} uses unknown dimension '${q.dimension}'`);
    }
    perDim[q.dimension] = (perDim[q.dimension] || 0) + 1;
  }
  for (const dimId of Object.keys(dims)) {
    if (perDim[dimId] !== 1) throw new ContentError(`Dimension '${dimId}' must have exactly one question`);
  }

  for (const [fieldId, field] of Object.entries(content.fieldsDoc.fields)) {
    for (const key of ['family', 'name_en', 'name_ar', 'profile']) {
      if (!(key in field)) throw new ContentError(`Field '${fieldId}' is missing '${key}'`);
    }
    const entries = Object.entries(field.profile);
    if (entries.length === 0) throw new ContentError(`Field '${fieldId}' has an empty profile`);
    for (const [dimId, pair] of entries) {
      if (!(dimId in dims)) throw new ContentError(`Field '${fieldId}' uses unknown dimension '${dimId}'`);
      const [target, weight] = pair;
      if (!(target >= 0 && target <= 1)) throw new ContentError(`Field '${fieldId}': target for '${dimId}' must be 0-1`);
      if (!(weight > 0)) throw new ContentError(`Field '${fieldId}': weight for '${dimId}' must be > 0`);
    }
  }

  const fit = content.config.fit_mode;
  if (fit !== undefined && fit !== 'neutral_zero' && fit !== 'legacy') {
    throw new ContentError(`Unknown fit_mode '${fit}'`);
  }
}

// ------------------------------------------------------ answers -> profile
/** Return a list of problems with the answers (empty list = valid). Never throws. */
function findAnswerProblems(answers, content) {
  const { min, max } = content.questionsDoc.scale;
  const questions = content.questionsDoc.questions;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    return ['answers must be an object of question_id -> number'];
  }
  const expected = new Set(questions.map((q) => q.id));
  const problems = [];
  for (const qid of [...expected].sort()) {
    if (!Object.prototype.hasOwnProperty.call(answers, qid)) {
      problems.push(`${qid}: missing`);
      continue;
    }
    const v = answers[qid];
    if (!Number.isInteger(v) || v < min || v > max) {
      problems.push(`${qid}: must be a whole number from ${min} to ${max}`);
    }
  }
  for (const qid of Object.keys(answers).sort()) {
    if (!expected.has(qid)) problems.push(`${qid}: unknown question id`);
  }
  return problems;
}

/** Throw AnswerValidationError unless every question has an integer 1-5. */
function validateAnswers(answers, content) {
  const problems = findAnswerProblems(answers, content);
  if (problems.length) throw new AnswerValidationError(problems);
}

/** answers -> { dimensionId: level between 0 and 1 } */
function buildStudentProfile(answers, content) {
  const { min, max } = content.questionsDoc.scale;
  const profile = {};
  for (const q of content.questionsDoc.questions) {
    profile[q.dimension] = (answers[q.id] - min) / (max - min);
  }
  return profile;
}

/** Helper for demos/tests: build a full answers object from {dimension: 1-5}; others get 3. */
function answersFromDimensions(levels, content, defaultValue = 3) {
  const byDim = {};
  for (const q of content.questionsDoc.questions) byDim[q.dimension] = q.id;
  const unknown = Object.keys(levels).filter((d) => !(d in byDim));
  if (unknown.length) throw new ContentError(`Unknown dimensions: ${unknown.sort().join(', ')}`);
  const answers = {};
  for (const qid of Object.values(byDim)) answers[qid] = defaultValue;
  for (const [dimId, value] of Object.entries(levels)) answers[byDim[dimId]] = value;
  return answers;
}

// ------------------------------------------------------------- one field
/** Fit of one student level against one field target (0 = poor, 1 = perfect). */
function dimensionFit(group, level, target, config = {}) {
  const mode = config.fit_mode || 'neutral_zero';
  const twoSided = TWO_SIDED_GROUPS.has(group);

  if (mode === 'legacy') {
    if (twoSided) return 1 - Math.min(1, Math.abs(level - target));
    if (target <= 0) return 1;
    return Math.min(1, level / target);
  }

  // neutral_zero: a neutral answer (level 0.5) is NOT evidence of fit.
  if (Math.abs(level - 0.5) < 1e-9) return 0;
  if (twoSided) return 1 - Math.min(1, Math.abs(level - target));
  const floor = config.evidence_floor ?? 0.25;
  const evidence = Math.max(0, (level - 0.5) / 0.5);
  const targetEvidence = Math.min(1, Math.max(floor, (target - 0.5) / 0.5));
  return Math.min(1, evidence / targetEvidence);
}

/** Score one field and return the score AND the per-dimension breakdown. */
function scoreField(student, fieldId, content) {
  const field = content.fieldsDoc.fields[fieldId];
  const groupWeights = content.config.group_weights;
  const dims = content.questionsDoc.dimensions;

  const byGroup = {};
  for (const [dimId, [target, weight]] of Object.entries(field.profile)) {
    const group = dims[dimId].group;
    (byGroup[group] = byGroup[group] || []).push([dimId, target, weight]);
  }

  // Group weights are re-normalised over the groups this field actually uses.
  const totalGroupWeight = sumPrecise(Object.keys(byGroup).map((g) => groupWeights[g]));

  const contributions = [];
  const groupScores = {};
  for (const [group, items] of Object.entries(byGroup)) {
    const groupShare = groupWeights[group] / totalGroupWeight;
    const sumW = items.reduce((s, [, , w]) => s + w, 0);
    let groupFitTotal = 0;
    for (const [dimId, target, weight] of items) {
      const level = student[dimId];
      const fit = dimensionFit(group, level, target, content.config);
      const share = groupShare * (weight / sumW); // this dimension's share of the 100 points
      contributions.push({
        dimension: dimId,
        group,
        student_level: round(level, 3),
        target,
        weight,
        fit: round(fit, 3),
        points: round(100 * share * fit, 2),
        points_lost: round(100 * share * (1 - fit), 2),
      });
      groupFitTotal += (weight / sumW) * fit;
    }
    groupScores[group] = round(100 * groupFitTotal, 1);
  }

  const score = sumPrecise(contributions.map((c) => c.points));
  contributions.sort((a, b) => b.points - a.points || (a.dimension < b.dimension ? -1 : 1));
  return { field_id: fieldId, score: round(score, 1), group_scores: groupScores, contributions };
}

// ---------------------------------------------------- ranking & selection
/** Score every field. Highest first; ties broken by field id so results are reproducible. */
function rankFields(student, content) {
  const results = Object.keys(content.fieldsDoc.fields).map((id) => scoreField(student, id, content));
  return results.sort((a, b) => b.score - a.score || (a.field_id < b.field_id ? -1 : 1));
}

/**
 * Pick the top fields with a diversity limit, plus alternatives.
 * DIVERSITY RULE: at most `max_per_family` fields from one family in the top list,
 * so the top 3 are not all near-duplicates (e.g. CS, Software Engineering, AI).
 * This is a presentation choice; the pure ranking is always returned too (full_ranking).
 */
function selectRecommendations(ranked, content) {
  const sel = content.config.selection;
  const chosen = [];
  const familyCounts = {};
  for (const r of ranked) {
    const family = content.fieldsDoc.fields[r.field_id].family;
    if ((familyCounts[family] || 0) >= sel.max_per_family) continue;
    chosen.push(r);
    familyCounts[family] = (familyCounts[family] || 0) + 1;
    if (chosen.length === sel.top_n) break;
  }
  const chosenIds = new Set(chosen.map((r) => r.field_id));
  const alternatives = ranked.filter((r) => !chosenIds.has(r.field_id)).slice(0, sel.alternatives_n);
  return { chosen, alternatives };
}

/** Coarse label for a score: 'strong', 'moderate' or 'exploratory'. */
function scoreBand(score, content) {
  const bands = [...content.config.bands].sort((a, b) => b.min_score - a.min_score);
  for (const b of bands) if (score >= b.min_score) return b.id;
  return 'exploratory';
}

// ------------------------------------------------------- profile summary
/** The student's most notable areas (ids + levels; the text is added later). */
function summariseProfile(student, content) {
  const dims = content.questionsDoc.dimensions;
  const top = (group, n) =>
    Object.entries(student)
      // Only answers of 4 or 5 (level >= 0.75) count as a notable area.
      .filter(([d, level]) => dims[d].group === group && level >= 0.75)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, n)
      .map(([dimension, level]) => ({ dimension, level: round(level, 3) }));

  const preferences = Object.entries(student)
    .filter(([d, level]) => dims[d].group === 'preferences' && Math.abs(level - 0.5) >= 0.25)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dimension, level]) => ({ dimension, pole: level > 0.5 ? 'high' : 'low', level: round(level, 3) }));

  return {
    top_interests: top('interests', 3),
    top_skills: top('skills', 3),
    preferences,
    top_values: top('values', 2),
    top_learning: top('learning', 2),
  };
}

// ----------------------------------------------------------- the main call
/** Validate answers and return the full, JSON-serialisable scoring result. */
function recommend(answers, content) {
  validateAnswers(answers, content);
  const student = buildStudentProfile(answers, content);

  const ranked = rankFields(student, content);
  const { chosen, alternatives } = selectRecommendations(ranked, content);
  const overallRank = {};
  ranked.forEach((r, i) => {
    overallRank[r.field_id] = i + 1;
  });

  const decorate = (result, displayRank) => ({
    ...result,
    display_rank: displayRank,
    overall_rank: overallRank[result.field_id],
    band: scoreBand(result.score, content),
  });

  const warnings = [];
  if (pstdev(Object.values(student)) < content.config.warnings.flat_profile_max_std) {
    warnings.push('flat_profile'); // answers barely differ -> results will not discriminate
  }
  const topScores = chosen.map((r) => r.score);
  if (topScores.length && Math.max(...topScores) - Math.min(...topScores) <= content.config.warnings.close_scores_max_spread) {
    warnings.push('close_scores'); // top fields are practically tied
  }

  const studentRounded = {};
  for (const [k, v] of Object.entries(student)) studentRounded[k] = round(v, 3);

  return {
    meta: {
      method: content.config.method,
      fit_mode: content.config.fit_mode || 'neutral_zero',
      questionnaire_version: content.questionsDoc.version,
      fields_version: content.fieldsDoc.version,
      config_version: content.config.version,
      status: 'draft_unvalidated',
    },
    student_profile: studentRounded,
    profile_summary: summariseProfile(student, content),
    recommended: chosen.map((r, i) => decorate(r, i + 1)),
    alternatives: alternatives.map((r) => decorate(r, null)),
    full_ranking: ranked.map((r) => ({ field_id: r.field_id, score: r.score })),
    warnings,
  };
}

module.exports = {
  ContentError,
  AnswerValidationError,
  loadContent,
  checkContent,
  findAnswerProblems,
  validateAnswers,
  buildStudentProfile,
  answersFromDimensions,
  dimensionFit,
  scoreField,
  rankFields,
  selectRecommendations,
  scoreBand,
  summariseProfile,
  recommend,
  round,
};
