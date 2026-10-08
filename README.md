---
sdk: gradio
app_file: app.py
---

# Career Explorer

Career Explorer is an early-stage, rule-based career exploration API. It compares answers to a bilingual English/Arabic questionnaire with career-field profiles, returns ranked recommendations and compatibility scores, and generates explanations from the scoring breakdown. It is a prototype for exploration—not a professional assessment or a guarantee of career success.

The Gradio app provides a browser-based questionnaire. The existing FastAPI API remains available separately, with interactive documentation at `/docs` when the API is running.

## Technologies

- Python 3.9+ (the included Docker image uses Python 3.11)
- Gradio, FastAPI, and Uvicorn
- JSON files for questionnaire, career-field, and scoring configuration
- Hugging Face Gradio Spaces, Docker, and Render deployment configurations

The scoring and explanation code has no external API or database dependency. Neither app requires API keys or other application secrets.

## Install

From the project root, create and activate a virtual environment, then install the pinned dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Run locally

Install dependencies as shown above, then start the Gradio questionnaire from the project root:

```bash
python app.py
```

Open the local URL printed by Gradio (normally `http://127.0.0.1:7860`).

To run the existing API instead, start it from the project root:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 7860
```

Then open:

- `http://127.0.0.1:7860/` — service welcome response
- `http://127.0.0.1:7860/health` — health check
- `http://127.0.0.1:7860/docs` — interactive API documentation

### API endpoints

- `POST /score` — accepts a JSON object with an `answers` object mapping every question ID (`q01`–`q27`) to an integer from 1 to 5; returns scores, rankings, and the scoring breakdown.
- `POST /explain` — accepts the same `answers` object and an optional `lang` value (`"en"` or `"ar"`); returns localized summaries and explanations.

See `content/questions.json` for the exact question wording and scale. Invalid or incomplete answers receive a `422` response. The API does not save questionnaire submissions; avoid sending personal or otherwise sensitive information.

### Demo and tests

Run the built-in synthetic demo (invented profiles only):

```bash
python scripts/demo_run.py
python scripts/demo_run.py ar
```

Run the test suite with Python's standard library:

```bash
python -m unittest discover -s tests -v
```

These tests check implementation behavior, not the real-world validity of the recommendations.

## Docker

Build and start the container from the project root:

```bash
docker build -t career-explorer-api .
docker run --rm -p 7860:7860 career-explorer-api
```

The container listens on port `7860`.

## Deploying on Render

The included `render.yaml` configures a Render web service, installs `requirements.txt`, starts Uvicorn, and checks `/health`. To deploy, connect the GitHub repository to Render and create a service from the repository's Blueprint. Render supplies the `PORT` environment variable used by the configured start command; no application-specific environment variables need to be set.

## Deploying on Hugging Face Spaces

The repository is configured as a Gradio Space in the README metadata. Create or select a Gradio Space, connect this repository, and let it install `requirements.txt` and run `app.py`. The Space provides the questionnaire UI; the FastAPI service remains available for a separate deployment using the existing Docker or Render configuration.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| None for local development | No | The application uses its bundled JSON content and has no external service credentials. |
| `PORT` on Render | Supplied by Render | Port used by the Render Uvicorn start command; no local `.env` file is needed. |
