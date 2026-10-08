from fastapi import FastAPI, HTTPException

from backend.services.explanation import DISCLAIMER, TemplateExplainer
from backend.services.scoring import AnswerValidationError, load_content, recommend

app = FastAPI(title="Career Explorer API")
content = load_content()
explainer = TemplateExplainer(content)


@app.get("/")
def read_root():
    return {"message": "Career Explorer API is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _recommend(payload: dict) -> dict:
    try:
        return recommend(payload.get("answers"), content)
    except AnswerValidationError as error:
        raise HTTPException(status_code=422, detail=error.problems) from error


@app.post("/score")
def score_answers(payload: dict):
    return _recommend(payload)


@app.post("/explain")
def explain_answers(payload: dict):
    lang = payload.get("lang", "en")
    if lang not in ("en", "ar"):
        raise HTTPException(status_code=422, detail="lang must be 'en' or 'ar'")

    result = _recommend(payload)
    return {
        "profile_summary": explainer.explain_profile(result["profile_summary"], lang),
        "recommended": [
            {
                "field_id": field["field_id"],
                "name": content.fields[field["field_id"]][f"name_{lang}"],
                "score": field["score"],
                "explanation": explainer.explain_field(field, lang),
            }
            for field in result["recommended"]
        ],
        "warnings": [explainer.warning_text(code, lang) for code in result["warnings"]],
        "disclaimer": DISCLAIMER[lang],
    }
