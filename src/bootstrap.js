'use strict';

require('dotenv').config();

const { loadConfig } = require('./config');
const { loadContent } = require('./services/scoringService');
const { TemplateExplainer } = require('./services/templateExplainer');
const { createGeminiService } = require('./services/geminiService');
const { createApp } = require('./createApp');

function createApplication() {
  const config = loadConfig();
  const content = loadContent();
  const explainer = new TemplateExplainer(content);
  const gemini = createGeminiService({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    timeoutMs: config.geminiTimeoutMs,
  });

  return {
    app: createApp({ content, explainer, gemini, config }),
    config,
    gemini,
  };
}

module.exports = { createApplication };
