'use strict';
/**
 * server.js - starts the web server.   Run with:  npm run dev   (or: npm start)
 */

const { app, config, gemini } = require('./bootstrap').createApplication();

app.listen(config.port, () => {
  console.log(`Career Explorer is running:  http://localhost:${config.port}`);
  if (gemini.isConfigured) {
    console.log(`Gemini: API key found, model "${config.geminiModel}". Run "npm run check-ai" to test it.`);
  } else {
    console.log('Gemini: no API key set. The app works with built-in explanations.');
    console.log('        To enable AI explanations, copy .env.example to .env and add your key (see README).');
  }
});
