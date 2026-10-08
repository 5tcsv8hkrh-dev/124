"""
explanation.py - turns the scoring breakdown into readable text (English / Arabic).

The explanations are built ONLY from the numbers the scoring engine already
produced (which dimensions added points, which lost points). So the text can
never claim something the calculation did not actually find.

`ExplanationService` is the interface. `TemplateExplainer` is the default
implementation and needs no internet and no API key. In Version 2 an
LLM-based explainer can implement the same interface. If it is added it must
only receive the anonymous scoring breakdown (dimension names and levels),
never free text that might contain personal details.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .scoring import Content

DISCLAIMER = {
    "en": "This result is an exploration tool, not a professional diagnosis or a guarantee of career success.",
    "ar": "هذه النتيجة أداة للاستكشاف، وليست تشخيصًا مهنيًا أو ضمانًا للنجاح الوظيفي.",
}

SCORE_LABEL = {"en": "Compatibility score", "ar": "درجة التوافق"}

SCORE_NOTE = {
    "en": "The score shows how closely your answers match a field profile used in this prototype. "
          "It is not a probability and does not measure your ability.",
    "ar": "تبيّن الدرجة مدى تطابق إجاباتك مع ملف المجال المستخدم في هذا النموذج الأولي. "
          "وهي ليست احتمالًا ولا تقيس قدراتك.",
}

BAND_LABEL = {
    "strong": {"en": "Strong match to explore", "ar": "توافق قوي يستحق الاستكشاف"},
    "moderate": {"en": "Moderate match", "ar": "توافق متوسط"},
    "exploratory": {"en": "Worth a look", "ar": "يستحق الاطلاع"},
}

WARNING_TEXT = {
    "flat_profile": {
        "en": "Your answers were very similar across most questions, so it is hard to tell fields apart. "
              "Consider retaking the assessment and using the full range of the scale.",
        "ar": "كانت إجاباتك متقاربة جدًا في معظم الأسئلة، لذلك يصعب التمييز بين المجالات. "
              "يمكنك إعادة التقييم واستخدام كامل نطاق المقياس.",
    },
    "close_scores": {
        "en": "Your top fields scored very close to each other, so please treat them as roughly equal rather than a strict order.",
        "ar": "جاءت درجات أعلى المجالات متقاربة جدًا، لذا اعتبرها متساوية تقريبًا وليست ترتيبًا صارمًا.",
    },
}


def join_list(items: list[str], lang: str) -> str:
    """'a, b and c' in English; 'أ، ب و ج' in Arabic."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if lang == "ar":
        return "، ".join(items[:-1]) + " و" + items[-1]
    return ", ".join(items[:-1]) + " and " + items[-1]


class ExplanationService(ABC):
    """Interface: anything that can explain a field result can be plugged in."""

    @abstractmethod
    def explain_field(self, field_result: dict, lang: str) -> str: ...


class TemplateExplainer(ExplanationService):
    """Default explainer: fixed sentence templates filled with the scoring breakdown."""

    def __init__(self, content: Content):
        self.content = content

    # ---- helpers -------------------------------------------------------
    def _label(self, dimension_id: str, lang: str) -> str:
        return self.content.dimensions[dimension_id][f"label_{lang}"]

    def _pole(self, dimension_id: str, pole: str, lang: str) -> str:
        return self.content.dimensions[dimension_id][f"{pole}_{lang}"]

    def _strength_text(self, c: dict, lang: str) -> str:
        """Text for a dimension that matched well."""
        if c["group"] == "preferences":
            pole = "high" if c["student_level"] > 0.5 else "low"
            phrase = self._pole(c["dimension"], pole, lang)
            return f"preference for {phrase}" if lang == "en" else f"تفضيل {phrase}"
        return self._label(c["dimension"], lang)

    def _gap_text(self, c: dict, lang: str) -> str:
        """Text for a dimension that matched poorly (what the field usually involves)."""
        if c["group"] == "preferences":
            pole = "high" if c["target"] > 0.5 else "low"
            return self._pole(c["dimension"], pole, lang)
        return self._label(c["dimension"], lang)

    # ---- public API ----------------------------------------------------
    def explain_field(self, field_result: dict, lang: str) -> str:
        cfg = self.content.config["explanation"]
        contributions = field_result["contributions"]

        # A "strength" must be a good fit AND something the student actually showed:
        # a neutral answer (3) that happens to match a low target is not a strength.
        def is_strength(c: dict) -> bool:
            if c["fit"] < cfg["strength_min_fit"]:
                return False
            if c["group"] == "preferences":
                return abs(c["student_level"] - 0.5) >= cfg["strength_min_preference_clarity"]
            return c["student_level"] >= cfg["strength_min_level"]

        strengths = [c for c in contributions if is_strength(c)]
        strengths.sort(key=lambda c: (-c["points"], c["dimension"]))
        strengths = strengths[: cfg["max_strengths"]]

        gaps = [c for c in contributions if c["fit"] < cfg["gap_max_fit"]]
        gaps.sort(key=lambda c: (-c["points_lost"], c["dimension"]))
        gaps = gaps[: cfg["max_gaps"]]

        parts = []
        if strengths:
            items = join_list([self._strength_text(c, lang) for c in strengths], lang)
            if lang == "ar":
                parts.append(f"بناءً على إجاباتك، يبدو أن هذا المجال يستحق الاستكشاف بسبب: {items}.")
            else:
                parts.append(f"Based on your answers, this field appears worth exploring because of: {items}.")
        else:
            parts.append(
                "Your answers only partly overlap with this field, so treat it as an option to explore, not a strong match."
                if lang == "en" else
                "تتداخل إجاباتك مع هذا المجال جزئيًا فقط، لذا اعتبره خيارًا للاستكشاف وليس توافقًا قويًا."
            )

        if gaps:
            items = join_list([self._gap_text(c, lang) for c in gaps], lang)
            if lang == "ar":
                parts.append(f"نقاط تستحق التحقق قبل أن تقرّر (كانت إجاباتك فيها أضعف أو تتجه في اتجاه مختلف): {items}.")
            else:
                parts.append(
                    f"Points to check before deciding (your answers were weaker or pointed another way): {items}."
                )
        return " ".join(parts)

    def explain_profile(self, profile_summary: dict, lang: str) -> dict[str, str]:
        """Readable lists for the 'Your strongest areas' section."""

        def labels(key: str) -> str:
            return join_list([self._label(i["dimension"], lang) for i in profile_summary[key]], lang)

        prefs = join_list(
            [self._pole(p["dimension"], p["pole"], lang) for p in profile_summary["preferences"]], lang
        )
        return {
            "interests": labels("top_interests"),
            "skills": labels("top_skills"),
            "preferences": prefs,
            "values": labels("top_values"),
            "learning": labels("top_learning"),
        }

    def warning_text(self, code: str, lang: str) -> str:
        return WARNING_TEXT[code][lang]
