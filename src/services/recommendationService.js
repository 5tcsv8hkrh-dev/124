'use strict';
/**
 * recommendationService.js - ties the pieces together for POST /api/recommendations.
 *
 *   validate request -> deterministic scoring -> template explanations
 *        -> (optional) Gemini insights, validated -> final JSON response
 *
 * IMPORTANT: the order, scores and bands come ONLY from scoringService. Gemini can add
 * text (overview, "why", suggestions) but can never change a score or a ranking.
 * If Gemini is off or fails, the response is still complete (template text).
 */

const { recommend } = require('./scoringService');
const { validateRecommendationRequest } = require('../utils/validation');
const { GeminiError } = require('./geminiService');
const { DISCLAIMER, SCORE_LABEL, SCORE_NOTE, BAND_LABEL } = require('./templateExplainer');

const MAX_CONTRIBUTIONS_SHOWN = 6;

/** Anonymous context for Gemini: labels in the student's language, answers 1-5, scores. */
function buildAiContext(base, language, content, explainer) {
  const dims = content.questionsDoc.dimensions;
  const { min, max } = content.questionsDoc.scale;
  const answerOf = (level) => Math.round(level * (max - min) + min);

  const profile = explainer.explainProfile(base.profile_summary, language);
  return {
    language,
    note: 'Answers are on a scale from 1 (lowest) to 5 (highest). Compatibility scores are 0-100 and are NOT probabilities.',
    student: {
      strongest_interests: profile.interests,
      strongest_skills: profile.skills,
      work_preferences: profile.preferences,
      values: profile.values,
      learning_styles: profile.learning,
    },
    fields: base.recommended.map((r) => {
      const parts = explainer.explainFieldParts(r, language);
      return {
        field_id: r.field_id,
        field_name: content.fieldsDoc.fields[r.field_id][`name_${language}`],
        compatibility_score: Math.round(r.score),
        strongest_matches: parts.strengths,
        points_to_check: parts.gaps,
        top_dimensions: r.contributions
          .filter((c) => c.fit > 0)
          .slice(0, 4)
          .map((c) => ({ area: dims[c.dimension][`label_${language}`], student_answer: answerOf(c.student_level) })),
      };
    }),
  };
}

function nextSteps(fieldId, language, content) {
  const info = content.fieldInfo[fieldId];
  if (!info) return null;
  const pick = (key) => info[key][language];
  return {
    subjects: pick('subjects'),
    majors: pick('majors'),
    careers: pick('careers'),
    skills: pick('skills'),
    activities: pick('activities'),
    questions: pick('questions'),
  };
}

function relatedFields(fieldId, language, content) {
  const info = content.fieldInfo[fieldId];
  if (!info) return [];
  return info.related
    .filter((id) => content.fieldsDoc.fields[id])
    .map((id) => ({ field_id: id, name: content.fieldsDoc.fields[id][`name_${language}`] }));
}

function buildFieldEntry(result, language, content, explainer, insights) {
  const field = content.fieldsDoc.fields[result.field_id];
  const dims = content.questionsDoc.dimensions;
  const { min, max } = content.questionsDoc.scale;
  const parts = explainer.explainFieldParts(result, language);
  const ai = insights ? insights.fields[result.field_id] : null;

  return {
    field_id: result.field_id,
    name: field[`name_${language}`],
    family: field.family,
    rank: result.display_rank, // null for alternatives
    overall_rank: result.overall_rank, // position by pure score (before the diversity rule)
    score: result.score,
    band: result.band,
    band_label: BAND_LABEL[result.band][language],
    explanation: {
      source: ai ? 'ai' : 'template',
      text: ai ? ai.why : parts.text,
      template_text: parts.text,
      strengths: parts.strengths,
      points_to_check: parts.gaps,
    },
    ai_suggestions: ai ? ai.practical_suggestions : [],
    contributions: result.contributions
      .filter((c) => c.points > 0)
      .slice(0, MAX_CONTRIBUTIONS_SHOWN)
      .map((c) => ({
        dimension: c.dimension,
        label: dims[c.dimension][`label_${language}`],
        group: c.group,
        answer: Math.round(c.student_level * (max - min) + min),
        points: c.points,
      })),
    next_steps: nextSteps(result.field_id, language, content),
    related: relatedFields(result.field_id, language, content),
  };
}

/**
 * @param {object} deps
 * @param {object} deps.body      the parsed JSON request body
 * @param {object} deps.content   from scoringService.loadContent()
 * @param {object} deps.explainer TemplateExplainer
 * @param {object} deps.gemini    service from createGeminiService() (or null)
 * @returns {Promise<object>} the response JSON
 * @throws {AppError} when the request is invalid (status 400)
 */
async function createRecommendation({ body, content, explainer, gemini }) {
  const { answers, language, useAI } = validateRecommendationRequest(body, content);

  // 1) Deterministic scoring. Nothing below can change these numbers.
  const base = recommend(answers, content);

  // 2) Optional AI text, validated. Any failure -> template fallback.
  let insights = null;
  const ai = { status: 'disabled', model: null, reason: null };
  if (useAI) {
    if (!gemini || !gemini.isConfigured) {
      ai.status = 'fallback';
      ai.reason = 'not_configured';
    } else {
      try {
        insights = await gemini.generateInsights(buildAiContext(base, language, content, explainer));
        ai.status = 'used';
        ai.model = gemini.model;
      } catch (err) {
        ai.status = 'fallback';
        ai.reason = err instanceof GeminiError ? err.code : 'unavailable';
      }
    }
  }

  // 3) Assemble the response.
  return {
    language,
    labels: {
      score_label: SCORE_LABEL[language],
      score_note: SCORE_NOTE[language],
      disclaimer: DISCLAIMER[language],
    },
    meta: { ...base.meta, ai },
    profile: explainer.explainProfile(base.profile_summary, language),
    ai_overview: insights ? insights.overview : null,
    recommended: base.recommended.map((r) => buildFieldEntry(r, language, content, explainer, insights)),
    alternatives: base.alternatives.map((r) => buildFieldEntry(r, language, content, explainer, null)),
    warnings: base.warnings.map((code) => ({ code, text: explainer.warningText(code, language) })),
  };
}

module.exports = { createRecommendation, buildAiContext };
