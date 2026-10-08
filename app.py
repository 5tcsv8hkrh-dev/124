import gradio as gr

from backend.services.explanation import (
    BAND_LABEL,
    DISCLAIMER,
    SCORE_NOTE,
    SCORE_LABEL,
    TemplateExplainer,
)
from backend.services.scoring import load_content, recommend

content = load_content()
explainer = TemplateExplainer(content)
questions = content.questions
languages = {
    "English": "en",
    "العربية": "ar",
}
question_groups = content.questions_doc["groups"]


def scale_choices(lang: str) -> list[tuple[str, int]]:
    labels = content.scale[f"agree_labels_{lang}"]
    return [
        (f"{value} — {label}", value)
        for value, label in enumerate(labels, start=content.scale["min"])
    ]


def update_question_language(lang_name: str) -> list[dict]:
    lang = languages[lang_name]
    return [
        gr.update(
            label=question[f"text_{lang}"],
            choices=scale_choices(lang),
        )
        for question in questions
    ]


def format_result(lang_name: str, *answers: int) -> str:
    lang = languages[lang_name]
    answer_map = {question["id"]: answer for question, answer in zip(questions, answers)}
    result = recommend(answer_map, content)
    profile = explainer.explain_profile(result["profile_summary"], lang)

    headings = {
        "en": {
            "profile": "Your strongest areas",
            "recommended": "Career fields to explore",
            "alternatives": "Other fields worth exploring",
            "warnings": "A note about these results",
        },
        "ar": {
            "profile": "أبرز مجالاتك",
            "recommended": "مجالات مهنية لاستكشافها",
            "alternatives": "مجالات أخرى تستحق الاستكشاف",
            "warnings": "ملاحظة حول هذه النتائج",
        },
    }[lang]
    profile_labels = {
        "en": {
            "interests": "Interests",
            "skills": "Strengths",
            "preferences": "Work preferences",
            "values": "Values",
            "learning": "Learning",
        },
        "ar": {
            "interests": "الاهتمامات",
            "skills": "نقاط القوة",
            "preferences": "تفضيلات العمل",
            "values": "القيم",
            "learning": "التعلّم",
        },
    }[lang]

    lines = [f"## {headings['profile']}"]
    for key, label in profile_labels.items():
        lines.append(f"- **{label}:** {profile[key] or '—'}")

    lines.append(f"\n## {headings['recommended']}")
    for item in result["recommended"]:
        name = content.fields[item["field_id"]][f"name_{lang}"]
        band = BAND_LABEL[item["band"]][lang]
        explanation = explainer.explain_field(item, lang)
        lines.append(
            f"\n### {item['display_rank']}. {name} — "
            f"{SCORE_LABEL[lang]}: {item['score']:.0f}/100 ({band})\n\n{explanation}"
        )

    lines.append(f"\n## {headings['alternatives']}")
    for item in result["alternatives"]:
        name = content.fields[item["field_id"]][f"name_{lang}"]
        lines.append(f"- {name} — {item['score']:.0f}/100")

    warning_text = [explainer.warning_text(code, lang) for code in result["warnings"]]
    if warning_text:
        lines.append(f"\n## {headings['warnings']}")
        lines.extend(f"- {warning}" for warning in warning_text)

    lines.append(f"\n_{SCORE_NOTE[lang]}_")
    lines.append(f"\n_{DISCLAIMER[lang]}_")
    return "\n".join(lines)


with gr.Blocks(title="Career Explorer") as demo:
    gr.Markdown(
        "# Career Explorer\n"
        "Answer the questions to explore career fields that may fit your interests "
        "and preferences. This early-stage tool is for exploration, not a professional assessment."
    )

    language = gr.Dropdown(
        choices=list(languages),
        value="English",
        label="Language / اللغة",
    )
    answer_inputs = []
    for group_id, group in question_groups.items():
        group_questions = [
            question
            for question in questions
            if content.dimensions[question["dimension"]]["group"] == group_id
        ]
        if not group_questions:
            continue
        with gr.Group():
            gr.Markdown(f"### {group['title_en']}")
            for question in group_questions:
                answer_inputs.append(
                    gr.Radio(
                        choices=scale_choices("en"),
                        value=3,
                        label=question["text_en"],
                    )
                )

    language.change(
        fn=update_question_language,
        inputs=language,
        outputs=answer_inputs,
    )
    submit = gr.Button("Explore career fields", variant="primary")
    result = gr.Markdown()
    submit.click(
        fn=format_result,
        inputs=[language, *answer_inputs],
        outputs=result,
    )


if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0")
