'use strict';
/**
 * check-gemini.js - makes ONE tiny real request to Gemini to prove your key and model work.
 *   Usage:  npm run check-ai
 *   Optional: npm run check-ai -- --list     (also lists model names your key can use)
 *
 * It prints SUCCESS only if Gemini really answered. It never prints your key.
 */

require('dotenv').config();
const { loadConfig } = require('../src/config');

async function main() {
  const config = loadConfig();
  if (!config.geminiApiKey) {
    console.log('No GEMINI_API_KEY found.');
    console.log('1) Copy .env.example to .env   2) Put your key after GEMINI_API_KEY=   3) Run this again.');
    process.exit(1);
  }

  let GoogleGenAI;
  try {
    ({ GoogleGenAI } = await import('@google/genai'));
  } catch {
    console.log('The @google/genai package is not installed. Run: npm install');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  if (process.argv.includes('--list')) {
    try {
      console.log('Models available to your key (names you can use for GEMINI_MODEL):');
      const pager = await ai.models.list();
      for await (const m of pager) {
        if (String(m.name).includes('gemini')) console.log('  ' + String(m.name).replace(/^models\//, ''));
      }
    } catch (err) {
      console.log(`Could not list models (${err.status || err.name}). You can still test the configured model below.`);
    }
  }

  console.log(`Testing model "${config.geminiModel}" ...`);
  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: 'Reply with exactly one word: OK',
    });
    const text = (response.text || '').trim();
    if (!text) throw new Error('empty response');
    console.log(`SUCCESS - Gemini answered: "${text.slice(0, 40)}"`);
    console.log('The AI explanations in the app should now work.');
  } catch (err) {
    const status = err.status || err.code || '';
    console.log(`FAILED - the request did not succeed (${status || err.name}).`);
    if (status === 400 || status === 401 || status === 403) console.log('Check that the key is correct and has the Gemini API enabled.');
    else if (status === 404) console.log('The model name may not exist or is not available to you. Run: npm run check-ai -- --list');
    else if (status === 429) console.log('You hit a rate or quota limit. Wait a minute and try again, or pick a different model.');
    else console.log('Check your internet connection, then try again. See the README troubleshooting section.');
    process.exit(1);
  }
}

main();
