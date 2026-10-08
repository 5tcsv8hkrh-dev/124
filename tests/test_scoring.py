"""
Tests for the Version 1 scoring engine.

Run from the project root with either:
    python -m unittest discover -s tests -v
    python -m pytest            (if pytest is installed)

IMPORTANT: the "persona sanity checks" below only confirm that the engine
behaves the way the developer intended on invented profiles. They are NOT
validation of the recommendations. Real evaluation needs real survey data.
"""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services.explanation import DISCLAIMER, TemplateExplainer  # noqa: E402
from backend.services.scoring import (  # noqa: E402
    AnswerValidationError,
    Content,
    ContentError,
    answers_from_dimensions,
    build_student_profile,
    check_content,
    dimension_fit,
    load_content,
    recommend,
    validate_answers,
)

CONTENT = load_content()


def demo_students() -> dict:
    data = json.loads((ROOT / "data" / "demo" / "demo_students.json").read_text(encoding="utf-8"))
    return {s["demo_id"]: s["answers_by_dimension"] for s in data["students"]}


class ContentTests(unittest.TestCase):
    def test_content_loads_and_is_consistent(self):
        check_content(CONTENT)  # raises ContentError if not
        self.assertEqual(len(CONTENT.questions), 27)
        self.assertGreaterEqual(len(CONTENT.fields), 15)

    def test_every_question_and_field_has_both_languages(self):
        for q in CONTENT.questions:
            self.assertTrue(q["text_en"].strip() and q["text_ar"].strip(), q["id"])
        for fid, f in CONTENT.fields.items():
            self.assertTrue(f["name_en"].strip() and f["name_ar"].strip(), fid)
        for did, d in CONTENT.dimensions.items():
            self.assertTrue(d["label_en"].strip() and d["label_ar"].strip(), did)

    def test_group_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(CONTENT.config["group_weights"].values()), 1.0)

    def test_bad_content_is_rejected(self):
        # A field that mentions a dimension that does not exist (typo) must fail loudly.
        fields_doc = copy.deepcopy(CONTENT.fields_doc)
        fields_doc["fields"]["law"]["profile"]["int_typo"] = [0.5, 1]
        with self.assertRaises(ContentError):
            check_content(Content(CONTENT.questions_doc, fields_doc, CONTENT.config))

        # A dimension with two questions must fail (Version 1 rule: exactly one).
        questions_doc = copy.deepcopy(CONTENT.questions_doc)
        extra = copy.deepcopy(questions_doc["questions"][0])
        extra["id"] = "q99"
        questions_doc["questions"].append(extra)
        with self.assertRaises(ContentError):
            check_content(Content(questions_doc, CONTENT.fields_doc, CONTENT.config))


class ValidationTests(unittest.TestCase):
    def good_answers(self):
        return answers_from_dimensions({}, CONTENT)

    def test_valid_answers_pass(self):
        validate_answers(self.good_answers(), CONTENT)

    def test_missing_answer(self):
        a = self.good_answers()
        del a["q05"]
        with self.assertRaises(AnswerValidationError) as ctx:
            validate_answers(a, CONTENT)
        self.assertIn("q05: missing", ctx.exception.problems)

    def test_out_of_range_and_wrong_types(self):
        for bad in (0, 6, -1, 2.5, "4", None, True):
            a = self.good_answers()
            a["q01"] = bad
            with self.assertRaises(AnswerValidationError, msg=repr(bad)):
                validate_answers(a, CONTENT)

    def test_unknown_question_id(self):
        a = self.good_answers()
        a["q999"] = 3
        with self.assertRaises(AnswerValidationError):
            validate_answers(a, CONTENT)

    def test_non_dict_answers(self):
        with self.assertRaises(AnswerValidationError):
            validate_answers([3] * 27, CONTENT)


class ScoringTests(unittest.TestCase):
    def test_profile_normalisation(self):
        low = build_student_profile(answers_from_dimensions({}, CONTENT, default=1), CONTENT)
        high = build_student_profile(answers_from_dimensions({}, CONTENT, default=5), CONTENT)
        self.assertTrue(all(v == 0.0 for v in low.values()))
        self.assertTrue(all(v == 1.0 for v in high.values()))

    def test_dimension_fit_one_sided(self):
        self.assertEqual(dimension_fit("interests", 1.0, 0.8), 1.0)   # above target: not penalised
        self.assertEqual(dimension_fit("interests", 0.4, 0.8), 0.5)   # proportional below target
        self.assertEqual(dimension_fit("skills", 0.0, 0.8), 0.0)

    def test_dimension_fit_two_sided(self):
        self.assertEqual(dimension_fit("preferences", 0.5, 0.5), 1.0)
        self.assertEqual(dimension_fit("preferences", 1.0, 0.0), 0.0)
        self.assertAlmostEqual(dimension_fit("preferences", 0.25, 0.75), 0.5)  # both directions count

    def test_points_add_up_to_score(self):
        """The explanation is faithful: per-dimension points sum to the final score."""
        for name, dims in demo_students().items():
            result = recommend(answers_from_dimensions(dims, CONTENT), CONTENT)
            for r in result["recommended"] + result["alternatives"]:
                total = sum(c["points"] for c in r["contributions"])
                self.assertAlmostEqual(total, r["score"], delta=0.15, msg=f"{name}/{r['field_id']}")

    def test_scores_are_between_0_and_100(self):
        for default in (1, 3, 5):
            result = recommend(answers_from_dimensions({}, CONTENT, default=default), CONTENT)
            for item in result["full_ranking"]:
                self.assertGreaterEqual(item["score"], 0)
                self.assertLessEqual(item["score"], 100)

    def test_all_lowest_answers_give_low_scores(self):
        result = recommend(answers_from_dimensions({}, CONTENT, default=1), CONTENT)
        self.assertLess(max(i["score"] for i in result["full_ranking"]), 25)

    def test_deterministic(self):
        a = answers_from_dimensions(demo_students()["demo_creative"], CONTENT)
        self.assertEqual(recommend(a, CONTENT), recommend(a, CONTENT))

    def test_result_is_json_serialisable(self):
        a = answers_from_dimensions(demo_students()["demo_creative"], CONTENT)
        json.dumps(recommend(a, CONTENT), ensure_ascii=False)

    def test_diversity_rule(self):
        max_per_family = CONTENT.config["selection"]["max_per_family"]
        for dims in demo_students().values():
            result = recommend(answers_from_dimensions(dims, CONTENT), CONTENT)
            families = [CONTENT.fields[r["field_id"]]["family"] for r in result["recommended"]]
            for fam in set(families):
                self.assertLessEqual(families.count(fam), max_per_family)
            self.assertEqual(len(result["recommended"]), CONTENT.config["selection"]["top_n"])
            # Alternatives never repeat a recommended field.
            rec_ids = {r["field_id"] for r in result["recommended"]}
            self.assertFalse(rec_ids & {r["field_id"] for r in result["alternatives"]})

    def test_full_ranking_is_pure_score_order(self):
        result = recommend(answers_from_dimensions(demo_students()["demo_tech_independent"], CONTENT), CONTENT)
        scores = [i["score"] for i in result["full_ranking"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_flat_profile_warning(self):
        result = recommend(answers_from_dimensions({}, CONTENT, default=3), CONTENT)
        self.assertIn("flat_profile", result["warnings"])

    def test_varied_profile_has_no_flat_warning(self):
        a = answers_from_dimensions(demo_students()["demo_tech_independent"], CONTENT)
        self.assertNotIn("flat_profile", recommend(a, CONTENT)["warnings"])


class PersonaSanityChecks(unittest.TestCase):
    """Sanity checks on INVENTED profiles. Not validation of the method."""

    def top_ids(self, name: str, n: int = 3) -> list[str]:
        result = recommend(answers_from_dimensions(demo_students()[name], CONTENT), CONTENT)
        return [r["field_id"] for r in result["full_ranking"][:n]]

    def test_tech_persona_gets_computing_field(self):
        computing = {"computer_science", "software_engineering", "cybersecurity", "artificial_intelligence", "data_science"}
        self.assertTrue(computing & set(self.top_ids("demo_tech_independent")))

    def test_people_persona_gets_people_field(self):
        self.assertTrue({"psychology", "education", "medicine"} & set(self.top_ids("demo_people_caring")))

    def test_creative_persona_gets_creative_field(self):
        self.assertTrue({"design", "architecture", "media"} & set(self.top_ids("demo_creative")))

    def test_science_persona_gets_science_field(self):
        self.assertTrue({"biotechnology", "physical_sciences", "environmental_science"} & set(self.top_ids("demo_lab_science")))


class ExplanationTests(unittest.TestCase):
    def setUp(self):
        self.explainer = TemplateExplainer(CONTENT)
        a = answers_from_dimensions(demo_students()["demo_tech_independent"], CONTENT)
        self.result = recommend(a, CONTENT)

    def test_explanations_exist_in_both_languages(self):
        for r in self.result["recommended"]:
            en = self.explainer.explain_field(r, "en")
            ar = self.explainer.explain_field(r, "ar")
            self.assertTrue(en.startswith("Based on your answers") or en.startswith("Your answers only partly"))
            self.assertTrue(any("\u0600" <= ch <= "\u06ff" for ch in ar), "Arabic text expected")

    def test_explanation_never_claims_certainty(self):
        banned = ("definitely", "you are suited", "you should become", "guarantee")
        for r in self.result["recommended"]:
            text = self.explainer.explain_field(r, "en").lower()
            self.assertFalse(any(b in text for b in banned))

    def test_neutral_answers_are_not_called_strengths(self):
        flat = recommend(answers_from_dimensions({}, CONTENT, default=3), CONTENT)
        for r in flat["recommended"]:
            self.assertTrue(self.explainer.explain_field(r, "en").startswith("Your answers only partly"))

    def test_profile_summary_and_disclaimer(self):
        summary = self.explainer.explain_profile(self.result["profile_summary"], "en")
        self.assertIn("technology", summary["interests"])
        self.assertIn("not a professional diagnosis", DISCLAIMER["en"])
        self.assertTrue(DISCLAIMER["ar"])


if __name__ == "__main__":
    unittest.main()
