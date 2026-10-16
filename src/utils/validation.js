'use strict';
/**
 * validation.js - checks the JSON body sent to POST /api/recommendations.
 *
 * Accepted body:
 *   {
 *     "answers":  { "q01": 1-5, ..., "q27": 1-5 },   // required, every question, whole numbers
 *     "language": "en" | "ar",                       // optional, default "en"
 *     "useAI":    true | false                       // optional, default true
 *   }
 *
 * There is intentionally NO free-text field: students cannot type personal
 * details into the app, so nothing identifying can reach Gemini.
 */

const { AppError } = require('./errors');
const { findAnswerProblems } = require('../services/scoringService');

const SUPPORTED_LANGUAGES = ['en', 'ar'];
const MAX_REPORTED_PROBLEMS = 10; // do not echo huge lists back to the client

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @returns {{answers: object, language: 'en'|'ar', useAI: boolean}}
 * @throws {AppError} status 400 with a list of problems
 */
function validateRecommendationRequest(body, content) {
  if (!isPlainObject(body)) {
    throw new AppError(400, 'invalid_request', 'The request body must be a JSON object.');
  }

  const problems = [];

  let language = 'en';
  if (body.language !== undefined) {
    if (!SUPPORTED_LANGUAGES.includes(body.language)) {
      problems.push(`language: must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
    } else {
      language = body.language;
    }
  }

  let useAI = true;
  if (body.useAI !== undefined) {
    if (typeof body.useAI !== 'boolean') problems.push('useAI: must be true or false');
    else useAI = body.useAI;
  }

  if (body.answers === undefined) {
    problems.push('answers: required');
  } else {
    problems.push(...findAnswerProblems(body.answers, content));
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
    if (problems.length > shown.length) shown.push(`...and ${problems.length - shown.length} more`);
    throw new AppError(400, 'invalid_request', 'Some of the information sent was missing or not valid.', shown);
  }

  return { answers: body.answers, language, useAI };
}

module.exports = { validateRecommendationRequest, SUPPORTED_LANGUAGES, isPlainObject };
