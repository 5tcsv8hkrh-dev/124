"""
scoring.py - the transparent, rule-based scoring engine (Version 1).

This file has NO web, database, or AI dependencies. It only reads the JSON
files in /content and does arithmetic, so every number it produces can be
checked by hand. That is deliberate: it is the baseline that any future
machine-learning model must be compared against.

HOW THE SCORE IS CALCULATED (read this once, it is the whole method):

1. Each answer (1-5) becomes a level between 0 and 1:  (answer - 1) / 4
   Each dimension (e.g. "interest in technology") has exactly one question,
   so the student profile is simply {dimension: level}.

2. Each field has a profile: for some dimensions a TARGET level (0-1) and a
   WEIGHT (importance, 1-3). Example: Cybersecurity wants
   int_technology target 0.8, weight 3.

3. For every dimension in the field's profile we compute a FIT between 0 and 1:
   - interests / skills / values / learning  ("more is fine"):
         fit = min(1, student_level / target)
     (a student above the target is not penalised, below it loses points
      in proportion)
   - preferences ("being close matters", e.g. team vs. independent):
         fit = 1 - |student_level - target|

4. Fits are averaged (weighted by importance) inside each group, then the
   groups are combined with the group weights from scoring_config.json:
         score = 100 * sum(group_weight * group_fit) / sum(group_weights used)
   Every dimension therefore adds a known number of POINTS to the score,
   and the points add up exactly to the final score. The explanation layer
   uses these points to say WHY a field was recommended.

The result is a compatibility score, NOT a probability and NOT a measure
of ability or future success.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass
from pathlib import Path

# content/ folder sits at the project root: <root>/backend/services/scoring.py
DEFAULT_CONTENT_DIR = Path(__file__).resolve().parents[2] / "content"

# Groups where "being at least as high as the target" is what matters.
ONE_SIDED_GROUPS = {"interests", "skills", "values", "learning"}
# Groups where being CLOSE to the target matters (both directions).
TWO_SIDED_GROUPS = {"preferences"}


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
class ContentError(Exception):
    """The JSON content files are inconsistent (a developer/researcher mistake)."""


class AnswerValidationError(ValueError):
    """The student's answers are invalid (missing, out of range, unknown ids)."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


# --------------------------------------------------------------------------
# Loading content
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Content:
    """Everything the engine needs, loaded from /content."""

    questions_doc: dict
    fields_doc: dict
    config: dict

    @property
    def questions(self) -> list[dict]:
        return self.questions_doc["questions"]

    @property
    def dimensions(self) -> dict:
        return self.questions_doc["dimensions"]

    @property
    def fields(self) -> dict:
        return self.fields_doc["fields"]

    @property
    def scale(self) -> dict:
        return self.questions_doc["scale"]


def _read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_content(content_dir: str | Path | None = None) -> Content:
    """Load and sanity-check questions.json, fields.json and scoring_config.json."""
    folder = Path(content_dir) if content_dir else DEFAULT_CONTENT_DIR
    content = Content(
        questions_doc=_read_json(folder / "questions.json"),
        fields_doc=_read_json(folder / "fields.json"),
        config=_read_json(folder / "scoring_config.json"),
    )
    check_content(content)
    return content


def check_content(content: Content) -> None:
    """Raise ContentError if the JSON files do not fit together.

    Catching these mistakes at load time protects the research: a typo in a
    dimension name would otherwise silently drop a field's requirement.
    """
    dims = content.dimensions
    groups = content.config["group_weights"]

    for dim_id, dim in dims.items():
        if dim["group"] not in groups:
            raise ContentError(f"Dimension '{dim_id}' has unknown group '{dim['group']}'")
        if dim["group"] in TWO_SIDED_GROUPS and not all(
            k in dim for k in ("low_en", "low_ar", "high_en", "high_ar")
        ):
            raise ContentError(f"Preference dimension '{dim_id}' needs low/high labels")

    ids = [q["id"] for q in content.questions]
    if len(ids) != len(set(ids)):
        raise ContentError("Duplicate question ids")

    # Version 1 rule: exactly one question per dimension.
    per_dim: dict[str, int] = {}
    for q in content.questions:
        if q["dimension"] not in dims:
            raise ContentError(f"Question {q['id']} uses unknown dimension '{q['dimension']}'")
        per_dim[q["dimension"]] = per_dim.get(q["dimension"], 0) + 1
    for dim_id in dims:
        if per_dim.get(dim_id, 0) != 1:
            raise ContentError(f"Dimension '{dim_id}' must have exactly one question")

    for field_id, field in content.fields.items():
        for key in ("family", "name_en", "name_ar", "profile"):
            if key not in field:
                raise ContentError(f"Field '{field_id}' is missing '{key}'")
        if not field["profile"]:
            raise ContentError(f"Field '{field_id}' has an empty profile")
        for dim_id, (target, weight) in field["profile"].items():
            if dim_id not in dims:
                raise ContentError(f"Field '{field_id}' uses unknown dimension '{dim_id}'")
            if not 0 <= target <= 1:
                raise ContentError(f"Field '{field_id}': target for '{dim_id}' must be 0-1")
            if weight <= 0:
                raise ContentError(f"Field '{field_id}': weight for '{dim_id}' must be > 0")


# --------------------------------------------------------------------------
# Answers -> student profile
# --------------------------------------------------------------------------
def validate_answers(answers: dict, content: Content) -> None:
    """Raise AnswerValidationError unless every question has an integer 1-5."""
    lo, hi = content.scale["min"], content.scale["max"]
    expected = {q["id"] for q in content.questions}
    problems: list[str] = []

    if not isinstance(answers, dict):
        raise AnswerValidationError(["answers must be an object of question_id -> number"])

    for qid in sorted(expected):
        if qid not in answers:
            problems.append(f"{qid}: missing")
            continue
        value = answers[qid]
        # bool is a subclass of int in Python, so exclude it explicitly.
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            problems.append(f"{qid}: must be a whole number from {lo} to {hi}")
    for qid in sorted(set(answers) - expected):
        problems.append(f"{qid}: unknown question id")

    if problems:
        raise AnswerValidationError(problems)


def build_student_profile(answers: dict, content: Content) -> dict[str, float]:
    """Turn validated answers into {dimension_id: level between 0 and 1}."""
    lo, hi = content.scale["min"], content.scale["max"]
    profile = {}
    for q in content.questions:
        profile[q["dimension"]] = (answers[q["id"]] - lo) / (hi - lo)
    return profile


def answers_from_dimensions(levels_1_to_5: dict[str, int], content: Content, default: int = 3) -> dict:
    """Helper for demos/tests: build a full answers dict from {dimension: 1-5}.

    Dimensions you do not mention get the neutral value (default=3).
    """
    by_dim = {q["dimension"]: q["id"] for q in content.questions}
    unknown = set(levels_1_to_5) - set(by_dim)
    if unknown:
        raise ContentError(f"Unknown dimensions: {sorted(unknown)}")
    answers = {qid: default for qid in by_dim.values()}
    for dim_id, value in levels_1_to_5.items():
        answers[by_dim[dim_id]] = value
    return answers


# --------------------------------------------------------------------------
# Scoring one field
# --------------------------------------------------------------------------
def dimension_fit(group: str, student_level: float, target: float) -> float:
    """How well one student level matches one field target (0 = poor, 1 = perfect)."""
    if group in TWO_SIDED_GROUPS:
        return 1.0 - min(1.0, abs(student_level - target))
    if target <= 0:
        return 1.0
    return min(1.0, student_level / target)


def score_field(student: dict[str, float], field_id: str, content: Content) -> dict:
    """Score one field. Returns the score AND the per-dimension breakdown."""
    field = content.fields[field_id]
    group_weights = content.config["group_weights"]

    # Collect the field's dimensions by group.
    by_group: dict[str, list[tuple[str, float, float]]] = {}
    for dim_id, (target, weight) in field["profile"].items():
        group = content.dimensions[dim_id]["group"]
        by_group.setdefault(group, []).append((dim_id, target, weight))

    # Group weights are re-normalised over the groups this field actually uses.
    total_group_weight = sum(group_weights[g] for g in by_group)

    contributions = []
    group_scores = {}
    for group, items in by_group.items():
        group_share = group_weights[group] / total_group_weight
        sum_w = sum(w for _, _, w in items)
        group_fit_total = 0.0
        for dim_id, target, weight in items:
            level = student[dim_id]
            fit = dimension_fit(group, level, target)
            share = group_share * (weight / sum_w)  # this dimension's share of 100 points
            contributions.append(
                {
                    "dimension": dim_id,
                    "group": group,
                    "student_level": round(level, 3),
                    "target": target,
                    "weight": weight,
                    "fit": round(fit, 3),
                    "points": round(100 * share * fit, 2),
                    "points_lost": round(100 * share * (1 - fit), 2),
                }
            )
            group_fit_total += (weight / sum_w) * fit
        group_scores[group] = round(100 * group_fit_total, 1)

    score = sum(c["points"] for c in contributions)
    return {
        "field_id": field_id,
        "score": round(score, 1),
        "group_scores": group_scores,
        "contributions": sorted(contributions, key=lambda c: -c["points"]),
    }


# --------------------------------------------------------------------------
# Ranking and selection
# --------------------------------------------------------------------------
def rank_fields(student: dict[str, float], content: Content) -> list[dict]:
    """Score every field. Sorted by score (highest first); ties broken by field id."""
    results = [score_field(student, fid, content) for fid in content.fields]
    return sorted(results, key=lambda r: (-r["score"], r["field_id"]))


def select_recommendations(ranked: list[dict], content: Content) -> tuple[list[dict], list[dict]]:
    """Pick the top fields with a diversity limit, plus alternatives.

    DIVERSITY RULE: at most `max_per_family` fields from the same family in the
    top list, so the top 3 are not all near-duplicates (e.g. CS, Software
    Engineering, AI). This is a presentation choice. The pure score ranking is
    always returned too (see `full_ranking`) so it can be evaluated separately.
    """
    sel = content.config["selection"]
    chosen: list[dict] = []
    family_counts: dict[str, int] = {}
    for result in ranked:
        family = content.fields[result["field_id"]]["family"]
        if family_counts.get(family, 0) >= sel["max_per_family"]:
            continue
        chosen.append(result)
        family_counts[family] = family_counts.get(family, 0) + 1
        if len(chosen) == sel["top_n"]:
            break

    chosen_ids = {r["field_id"] for r in chosen}
    alternatives = [r for r in ranked if r["field_id"] not in chosen_ids][: sel["alternatives_n"]]
    return chosen, alternatives


def score_band(score: float, content: Content) -> str:
    """Map a score to a coarse label ('strong', 'moderate', 'exploratory')."""
    for band in sorted(content.config["bands"], key=lambda b: -b["min_score"]):
        if score >= band["min_score"]:
            return band["id"]
    return "exploratory"


# --------------------------------------------------------------------------
# Student profile summary (strongest areas, preferences)
# --------------------------------------------------------------------------
def summarise_profile(student: dict[str, float], content: Content) -> dict:
    """Pick out the student's most notable areas (ids + levels; text is added later)."""

    def top(group: str, n: int) -> list[dict]:
        # Only answers of 4 or 5 (level >= 0.75) count as a notable area.
        # A neutral answer (3) is not evidence of a strength or interest.
        items = [
            (dim_id, level)
            for dim_id, level in student.items()
            if content.dimensions[dim_id]["group"] == group and level >= 0.75
        ]
        items.sort(key=lambda x: (-x[1], x[0]))
        return [{"dimension": d, "level": round(l, 3)} for d, l in items[:n]]

    preferences = []
    for dim_id, level in sorted(student.items()):
        if content.dimensions[dim_id]["group"] == "preferences" and abs(level - 0.5) >= 0.25:
            preferences.append(
                {"dimension": dim_id, "pole": "high" if level > 0.5 else "low", "level": round(level, 3)}
            )

    return {
        "top_interests": top("interests", 3),
        "top_skills": top("skills", 3),
        "preferences": preferences,
        "top_values": top("values", 2),
        "top_learning": top("learning", 2),
    }


# --------------------------------------------------------------------------
# The one function the API will call
# --------------------------------------------------------------------------
def recommend(answers: dict, content: Content) -> dict:
    """Validate answers and return the full, JSON-serialisable result."""
    validate_answers(answers, content)
    student = build_student_profile(answers, content)

    ranked = rank_fields(student, content)
    recommended, alternatives = select_recommendations(ranked, content)

    overall_rank = {r["field_id"]: i + 1 for i, r in enumerate(ranked)}

    def decorate(result: dict, display_rank: int | None) -> dict:
        # display_rank: position in the list shown to the student (None for alternatives).
        # overall_rank: position by pure score, so the effect of the diversity rule is visible.
        return {
            **result,
            "display_rank": display_rank,
            "overall_rank": overall_rank[result["field_id"]],
            "band": score_band(result["score"], content),
        }

    # Warnings are codes; the explanation layer turns them into text.
    warnings = []
    spread = statistics.pstdev(student.values())
    if spread < content.config["warnings"]["flat_profile_max_std"]:
        warnings.append("flat_profile")  # answers barely differ -> results will not discriminate
    top_scores = [r["score"] for r in recommended]
    if top_scores and max(top_scores) - min(top_scores) <= content.config["warnings"]["close_scores_max_spread"]:
        warnings.append("close_scores")  # top fields are practically tied

    return {
        "meta": {
            "method": content.config["method"],
            "questionnaire_version": content.questions_doc["version"],
            "fields_version": content.fields_doc["version"],
            "config_version": content.config["version"],
            "status": "draft_unvalidated",
        },
        "student_profile": {k: round(v, 3) for k, v in student.items()},
        "profile_summary": summarise_profile(student, content),
        "recommended": [decorate(r, i + 1) for i, r in enumerate(recommended)],
        "alternatives": [decorate(r, None) for r in alternatives],
        "full_ranking": [{"field_id": r["field_id"], "score": r["score"]} for r in ranked],
        "warnings": warnings,
    }
