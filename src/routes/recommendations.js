'use strict';
/**
 * routes/recommendations.js - plain request handlers (no Express import, so they can be
 * unit-tested with fake req/res objects). src/routes/index.js attaches them to URLs.
 */

const { createRecommendation } = require('../services/recommendationService');
const { DISCLAIMER } = require('../services/templateExplainer');

function createHandlers({ content, explainer, gemini, config }) {
  /** GET /api/health - is the server running? (does NOT prove the AI works) */
  function health(req, res) {
    res.json({
      status: 'ok',
      ai: {
        configured: Boolean(gemini && gemini.isConfigured), // a key is present; it may still be invalid
        model: gemini && gemini.isConfigured ? config.geminiModel : null,
      },
      method: content.config.method,
    });
  }

  /** GET /api/questions - the questionnaire (both languages, no scoring weights). */
  function questions(req, res) {
    const doc = content.questionsDoc;
    res.json({
      version: doc.version,
      status: doc.status,
      scale: doc.scale,
      groups: doc.groups,
      disclaimer: DISCLAIMER,
      questions: doc.questions.map((q) => {
        const dim = doc.dimensions[q.dimension];
        const item = { id: q.id, group: dim.group, type: q.type, text_en: q.text_en, text_ar: q.text_ar };
        if (q.type === 'bipolar') {
          item.low_en = dim.low_en;
          item.low_ar = dim.low_ar;
          item.high_en = dim.high_en;
          item.high_ar = dim.high_ar;
        }
        return item;
      }),
    });
  }

  /** GET /api/careers - all fields with their descriptive information (no scoring weights). */
  function careers(req, res) {
    res.json({
      version: content.fieldsDoc.version,
      status: content.fieldsDoc.status,
      fields: Object.entries(content.fieldsDoc.fields).map(([id, f]) => ({
        field_id: id,
        family: f.family,
        name_en: f.name_en,
        name_ar: f.name_ar,
        info: content.fieldInfo[id] || null,
      })),
    });
  }

  /** POST /api/recommendations - score the answers and (optionally) add AI explanations. */
  async function recommendations(req, res, next) {
    try {
      const result = await createRecommendation({ body: req.body, content, explainer, gemini });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  return { health, questions, careers, recommendations };
}

module.exports = { createHandlers };
