"""
demo_run.py - print recommendations for the SYNTHETIC demo students.

Run from the project root:
    python scripts/demo_run.py            # English
    python scripts/demo_run.py ar         # Arabic
    python scripts/demo_run.py en demo_creative   # one persona only

The output is only for checking that the engine works. It is NOT a research
result: the demo students are invented.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services.explanation import DISCLAIMER, SCORE_LABEL, BAND_LABEL, TemplateExplainer  # noqa: E402
from backend.services.scoring import answers_from_dimensions, load_content, recommend  # noqa: E402


def main() -> None:
    lang = sys.argv[1] if len(sys.argv) > 1 else "en"
    only = sys.argv[2] if len(sys.argv) > 2 else None
    if lang not in ("en", "ar"):
        sys.exit("Language must be 'en' or 'ar'")

    content = load_content()
    explainer = TemplateExplainer(content)
    demo = json.loads((ROOT / "data" / "demo" / "demo_students.json").read_text(encoding="utf-8"))
    print(f"[{demo['data_source'].upper()} DATA - synthetic, not real students]\n")

    for student in demo["students"]:
        if only and student["demo_id"] != only:
            continue
        answers = answers_from_dimensions(student["answers_by_dimension"], content)
        result = recommend(answers, content)

        print("=" * 70)
        print(student["demo_id"], "-", student["description"])
        summary = explainer.explain_profile(result["profile_summary"], lang)
        for key, text in summary.items():
            print(f"  {key:12s}: {text}")
        print()
        for r in result["recommended"]:
            name = content.fields[r["field_id"]][f"name_{lang}"]
            print(f"  {r['display_rank']}. {name} - {SCORE_LABEL[lang]}: {r['score']:.0f} "
                  f"({BAND_LABEL[r['band']][lang]}) [pure rank #{r['overall_rank']}]")
            print("     " + explainer.explain_field(r, lang))
        print("  Other fields worth exploring:")
        for r in result["alternatives"]:
            name = content.fields[r["field_id"]][f"name_{lang}"]
            print(f"     - {name} ({r['score']:.0f})")
        for code in result["warnings"]:
            print("  !", explainer.warning_text(code, lang))
        print()
    print(DISCLAIMER[lang])


if __name__ == "__main__":
    main()
