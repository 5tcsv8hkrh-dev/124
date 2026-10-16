# Masarat (مسارات) - Career Explorer for Arab Students

A bilingual (Arabic / English) web app that helps secondary-school and university students **explore** academic
and career fields that may fit their interests, strengths and preferences.

* The student answers 27 short questions.
* A **transparent scoring system** (plain JavaScript, no AI) ranks 19 fields and shows exactly which answers added points.
* **Google Gemini** (optional) writes a friendly overview and practical suggestions. It never changes scores or order.
* If Gemini is not set up or fails, the app still works with built-in explanations.

> **This is a research prototype.** It is not a psychological test, a professional career assessment or a diagnosis,
> and it has **not been scientifically validated**. Results say "worth exploring", never "you should become X".
> The field profiles and questions are first drafts that experts have not reviewed.
> The four demo students in `tests/fixtures/` are **invented** and are not research data.

---

## Contents
1. [What you need](#1-what-you-need)
2. [Install Node.js](#2-install-nodejs)
3. [Open the project in VS Code](#3-open-the-project-in-vs-code)
4. [Install the dependencies](#4-install-the-dependencies)
5. [Run the tests](#5-run-the-tests)
6. [Start the app (works without AI)](#6-start-the-app-works-without-ai)
7. [Set up the Gemini API key](#7-set-up-the-gemini-api-key)
8. [Choosing a Gemini model](#8-choosing-a-gemini-model)
9. [Check that Gemini really works](#9-check-that-gemini-really-works)
10. [How the project is organised](#10-how-the-project-is-organised)
11. [How the scoring works](#11-how-the-scoring-works)
12. [API reference](#12-api-reference)
13. [Privacy and research notes](#13-privacy-and-research-notes)
14. [Customising](#14-customising)
15. [Troubleshooting](#15-troubleshooting)
16. [Limitations](#16-limitations)

---

## 1. What you need
* A computer (Windows, macOS or Linux) and an internet connection for installing.
* [Visual Studio Code](https://code.visualstudio.com/) (free).
* Node.js 20 or newer (next step).
* *Optional:* a Google account to create a free Gemini API key (step 7). The app works without it.

## 2. Install Node.js
1. Go to <https://nodejs.org> and download the **LTS** version. Run the installer and accept the defaults.
2. **Close and reopen** VS Code / your terminal, then check:
   ```
   node --version
   npm --version
   ```
   `node --version` must print `v20` or higher (for example `v22.x.x`). If you see "command not found", restart the computer and try again.

## 3. Open the project in VS Code
1. Unzip the project folder `career-explorer-js` somewhere simple (for example your Documents folder).
2. In VS Code choose **File > Open Folder...** and select `career-explorer-js`.
3. Open the terminal inside VS Code: **Terminal > New Terminal** (shortcut: Ctrl + `).
   Make sure the terminal path ends with `career-explorer-js`.

## 4. Install the dependencies
```
npm install
```
This downloads Express, dotenv, @google/genai, helmet and express-rate-limit into a `node_modules` folder.
It can take a minute. It is finished when you see a line like `added 100 packages`. Warnings are usually fine; red `npm ERR!` lines are not (see [Troubleshooting](#15-troubleshooting)).

## 5. Run the tests
```
npm test
```
Look at the last lines. You should see `# fail 0`. After `npm install`, the tests that exercise the real Express server run too,
so nothing should say `skipped`. If a test fails, copy the failing lines and ask for help before continuing.

## 6. Start the app (works without AI)
```
npm run dev
```
You should see:
```
Career Explorer is running:  http://localhost:3000
Gemini: no API key set. The app works with built-in explanations.
```
Open <http://localhost:3000> in your browser. Click **Start the assessment**, answer the 27 questions, and read the results.
Use the **English / العربية** buttons in the header to switch language (Arabic switches the page to right-to-left).

`npm run dev` restarts the server automatically when you change a file. Stop it with **Ctrl + C**.
To run without auto-restart use `npm start`.

> Do not double-click `public/index.html`. The page needs the server (`npm run dev`) to load the questions and calculate results.

Optional quick check of the running server (open a **second** terminal):
```
npm run smoke
```
It calls every endpoint over HTTP and prints PASS or FAIL. It does not use Gemini.

## 7. Set up the Gemini API key
You do this yourself. **Never paste your key into a chat, a screenshot, an email or a GitHub file.**

1. Open Google AI Studio's key page: <https://aistudio.google.com/apikey> and sign in with your Google account.
2. Create an API key and copy it. (Follow Google's current on-screen steps; the page may change.)
3. In the project folder, make your private settings file by copying the example:
   * Windows PowerShell: `Copy-Item .env.example .env`
   * Windows Command Prompt: `copy .env.example .env`
   * macOS / Linux: `cp .env.example .env`
4. Open the new `.env` file in VS Code and replace the placeholder:
   ```
   GEMINI_API_KEY=paste_your_real_key_here
   ```
   No quotes, no spaces around `=`. Save the file.
5. Stop the server (Ctrl + C) and start it again with `npm run dev`. You should now see
   `Gemini: API key found, model "...". Run "npm run check-ai" to test it.`

How your key is protected:
* It is only read in `src/config.js` from `process.env.GEMINI_API_KEY`, and only used by `src/services/geminiService.js` on the server.
* `.env` is listed in `.gitignore`, so Git will not upload it. `.env.example` contains a placeholder only.
* The key is never sent to the browser, never put in a response and never printed in logs.
* If you ever expose it by accident, delete that key in Google AI Studio and create a new one.

## 8. Choosing a Gemini model
The model is set in `.env` with `GEMINI_MODEL`. The default is `gemini-3.5-flash-lite` (a fast, low-cost model that suits short
explanations). At the time this was written Google's models page recommended `gemini-3.5-flash-lite` or `gemini-3.8-flash`
for new projects. **Model names change and not every model is available to every account**, so check:
* Google's list: <https://ai.google.dev/gemini-api/docs/models>
* The models your own key can use: `npm run check-ai -- --list`

To change the model, edit `.env`, for example `GEMINI_MODEL=gemini-3.8-flash`, then restart the server and run `npm run check-ai`.

## 9. Check that Gemini really works
Do these in order. Only the last one proves the AI is working.

1. **Server is running:** open <http://localhost:3000/api/health>. You should see `"status":"ok"`.
   `"ai":{"configured":true,...}` only means a key *exists*; it does not prove the key or model is valid.
2. **Real test request:**
   ```
   npm run check-ai
   ```
   It sends one tiny request to Gemini and prints `SUCCESS - Gemini answered: "OK"` only if Gemini really answered.
   If it prints `FAILED`, read the hint it gives and the [Troubleshooting](#15-troubleshooting) table.
3. **In the app:** on the home page keep **Use AI-written explanations** ticked, complete the questionnaire, and look at the grey box
   at the top of the results. It should say *"The explanations below were written with AI (Google Gemini)..."*, and each field shows a
   *Written by AI* label. If it says the built-in system wrote them, the reason is shown (for example "The AI service is busy right now").

## 10. How the project is organised
```
career-explorer-js/
├── public/                      what the browser loads (the website)
│   ├── index.html               all screens: home, questions, loading, results, error
│   ├── css/styles.css           design, dark mode, right-to-left support
│   └── js/
│       ├── i18n.js              ALL interface text in English and Arabic
│       ├── dom.js               safe helper for building page elements
│       ├── questionnaire.js     one question at a time + progress
│       ├── results.js           builds the results page
│       └── app.js               language switch, screens, talks to the API
├── src/                         the server
│   ├── server.js                starts the server (loads .env)
│   ├── app.js                   builds the Express app (security headers, routes)
│   ├── config.js                reads environment settings
│   ├── routes/                  recommendations.js (handlers), index.js (URLs + rate limits)
│   ├── services/
│   │   ├── scoringService.js    deterministic scoring (NO AI)
│   │   ├── templateExplainer.js built-in explanations (also the fallback)
│   │   ├── geminiService.js     the ONLY file that talks to Gemini
│   │   └── recommendationService.js  puts it together
│   ├── utils/                   validation.js, errors.js, errorHandler.js
│   └── data/                    questions.json, fields.json, scoring_config.json, field_info.json
├── tests/                       automated tests (npm test)
├── scripts/                     smoke.js (npm run smoke), check-gemini.js (npm run check-ai)
├── docs/SCORING_CHANGELOG.md    every change to the scoring method, with evidence
├── legacy-python/               the original Python prototype, kept for reference (not used)
├── data/real/                   for REAL survey exports only; never committed to Git
├── .env.example  .gitignore  package.json  README.md
```

**Data flow:** browser -> `POST /api/recommendations` -> validate -> **scoring (no AI)** -> template explanations ->
*(optional)* Gemini text, checked -> JSON back to the browser.

## 11. How the scoring works
Details and the history of changes are in [`docs/SCORING_CHANGELOG.md`](docs/SCORING_CHANGELOG.md). In short:

1. Each answer 1-5 becomes a level from 0 to 1. Each of 27 dimensions (e.g. "interest in technology") has exactly one question.
2. Each field has a profile in `src/data/fields.json`: for some dimensions a **target** and a **weight** (importance 1-3).
3. A neutral answer (3) gives **no points**. Clear agreement gives points in proportion to how well it meets the target.
   For work preferences (team vs. alone, etc.) being close to the field's target counts.
4. Points are combined with group weights (interests 40 %, skills 25 %, preferences 15 %, values 10 %, learning 10 %).
5. The score (0-100) is a **compatibility score**, not a probability and not a measure of ability.
   "How this score was built" on every field lists the answers that added points, and the points add up to the score exactly (this is tested).
6. The top 3 show at most 2 fields from the same family (so you do not get three near-identical computing fields). When a field
   is shown above a field with a higher score, the page says so.
7. Bands ("Strong match to explore", "Moderate match", "Worth a look") use thresholds 75 and 60. These are **arbitrary** and not yet calibrated.

Gemini receives the already-calculated result and may only write text about it. A test checks that scores, bands and order are identical with and without AI.

## 12. API reference
| Method and URL | What it does |
|---|---|
| `GET /api/health` | `{ "status": "ok", "ai": { "configured": true/false, "model": ... } }` |
| `GET /api/questions` | The 27 questions in both languages (no scoring weights) |
| `GET /api/careers` | The 19 fields with names and next-step information in both languages |
| `POST /api/recommendations` | Scores answers and returns results |

`POST /api/recommendations` body:
```json
{ "answers": { "q01": 5, "q02": 3, "...": 4, "q27": 2 }, "language": "en", "useAI": true }
```
* `answers`: required, all of `q01`..`q27`, whole numbers 1-5. `language`: `"en"` or `"ar"` (default `"en"`). `useAI`: default `true`.
* There is deliberately **no free-text field**.
* Success: `{ language, labels, meta, profile, ai_overview, recommended[3], alternatives[4], warnings }`. `meta.ai.status` is
  `used`, `disabled` or `fallback` (with a short `reason`).
* Errors are always `{ "error": { "code": "...", "message": "..." } }` with status 400 (invalid), 413 (too large), 429 (rate limit) or 500.
  Stack traces, file paths and keys are never included.

Rate limit: 6 recommendation requests per minute per address by default (`RATE_LIMIT_PER_MINUTE` in `.env`), 300 API calls per 15 minutes overall.

What Gemini's answer must look like (anything else is rejected and the built-in text is used):
```json
{ "overview": "...", "fields": [ { "field_id": "...", "why": "...", "practical_suggestions": ["...", "..."] } ] }
```
It is rejected if it is not valid JSON, misses or invents a field, has too few/many suggestions, is too long, contains links,
percentages or markup, uses certainty language ("definitely", "guaranteed", "you will become"...), or is in the wrong language.
A 20-second timeout (`GEMINI_TIMEOUT_MS`) and the error handling cover slow answers, rate limits (429), bad keys and outages.

## 13. Privacy and research notes
* **No personal data is requested.** No name, email, phone, ID or free text. The server does **not save** answers or results.
* **What is sent to Gemini (only if the student leaves the AI box ticked and a key is configured):** anonymous labels such as
  "interest in technology" with answers from 1 to 5, and the field scores. Nothing else. The student can untick the box.
* Check Google's current terms for the Gemini API to see how submitted content may be handled, since terms can differ between
  free and paid use. If that is not acceptable for your participants, leave `GEMINI_API_KEY` empty: the app works fully without AI.
* The default state of the AI checkbox is set by `DEFAULT_USE_AI` at the top of `public/js/app.js`.
* **Survey data (Google Forms) is separate.** Collect it anonymously, with clear consent and a way to opt out, and keep real exports in
  `data/real/` (ignored by Git). Never mix them with the synthetic demo data. **If participants may be under 18, additional
  ethical approval and parental/guardian consent may be required** - confirm this with your supervisor or ethics committee first.
* Nothing in this repository is a research finding. No accuracy has been measured. Do not report results as validated until you have
  evaluated the method on real data.

## 14. Customising
| I want to... | Edit |
|---|---|
| Change a question or add a translation | `src/data/questions.json` (keep one question per dimension) |
| Change a field's profile | `src/data/fields.json` (`"dimension": [target, weight]`) |
| Change next-step text for a field | `src/data/field_info.json` |
| Change interface text | `public/js/i18n.js` |
| Change group weights, bands, diversity | `src/data/scoring_config.json` (bump `version`, record it in `docs/SCORING_CHANGELOG.md`) |
| Change colours | variables at the top of `public/css/styles.css` |
| Change the Gemini model, port, timeout, rate limit | `.env` |

After editing the JSON files run `npm test`. It checks that dimensions, languages and field references still match.

## 15. Troubleshooting
| Problem | What to do |
|---|---|
| `node` / `npm` is not recognised | Install Node.js (step 2), then close and reopen VS Code. Restart the computer if needed. |
| PowerShell: "running scripts is disabled" | Use **Command Prompt** (Terminal > New Terminal, choose "Command Prompt"), or run PowerShell once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `npm install` fails with `ETIMEDOUT` / `ENOTFOUND` | Check your internet connection or proxy, then run `npm install` again. |
| `npm ERR! notarget No matching version` | A version in `package.json` is not available. Run `npm install express@latest helmet@latest express-rate-limit@latest dotenv@latest @google/genai@latest` and run `npm test`. |
| `Cannot find module 'express'` | You skipped `npm install`, or you are in the wrong folder. Run `npm install` inside `career-explorer-js`. |
| `Error: listen EADDRINUSE ... 3000` | Something else uses port 3000. Set `PORT=3001` in `.env` (create it from `.env.example`) and restart, then open `http://localhost:3001`. |
| The page opens but "We could not reach the server" | The server is not running. Start `npm run dev` and keep that terminal open. |
| Page looks unstyled or buttons do nothing | Open the site through `http://localhost:3000`, not as a file. Press Ctrl+Shift+R to reload. Check the browser console (F12) for red errors. |
| Results say "AI explanations are not set up on this server" | `.env` is missing or the key line is empty/placeholder. Redo step 7 and restart the server. |
| `npm run check-ai` says **400 / 401 / 403** | The key is wrong, has extra spaces/quotes, or the Gemini API is not enabled for it. Create a new key in Google AI Studio and update `.env`. |
| `check-ai` says **404** | The model name is wrong or not available to you. Run `npm run check-ai -- --list` and set `GEMINI_MODEL` to one it prints. |
| `check-ai` says **429** or results say "AI service is busy" | You hit a free-tier limit. Wait a minute, try a different model, or continue without AI. |
| Results say "The AI answer did not pass our safety checks" | Gemini replied in an unexpected format. Try again; the built-in text is shown meanwhile. |
| "You have made too many requests" | The rate limit protects your quota. Wait a minute, or raise `RATE_LIMIT_PER_MINUTE` in `.env`. |
| Changes to `.env` have no effect | Stop (Ctrl + C) and start the server again. `.env` is read only at start-up. |
| Arabic text shows as boxes | Your system lacks an Arabic font (rare). Update your OS fonts or browser. |
| A test fails | Run `npm test` again, copy the failing lines, and get help before changing anything. |

## 16. Limitations
* The questionnaire and field profiles are **drafts without expert review or validation**. No claim of accuracy is made.
* Self-rated answers are not measured ability. One question per dimension is a weak measurement.
* A student who agrees with everything (all 4s and 5s) cannot be told apart from one who likes everything; the app only warns about it.
* Score bands and the diversity setting are arbitrary placeholders until calibrated on real data.
* The Arabic wording has not been reviewed by an Arabic-language expert.
* Gemini output is checked for format, length, links, percentages, certainty phrases and language, but **not fact-checked**; the prompt
  tells it to use only the supplied results, and the interface labels AI text as AI-written.
* The next-step content (subjects, majors, careers, activities) is general orientation text, not reviewed, with no salary or job-market claims.
* The interface was tested with automated tests and a simulated browser, not on every real browser and device.
  Please look at it on a phone and in both languages yourself.
* Planned for later: a real survey dataset and evaluation, an ML model compared against this baseline, multiple-choice questions, more
  countries and fields, student feedback after choosing a field.
