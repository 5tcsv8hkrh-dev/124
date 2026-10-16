# Scoring method changelog

The scoring method is the main scientific assumption of this prototype, so every change to it is recorded here.
Numbers in `src/data/scoring_config.json` are **arbitrary starting values**, not values learned from data.

## v0.2.0-draft (current, `fit_mode: "neutral_zero"`)

**Problem found in v0.1.** The original rule gave a field full credit whenever the student's answer was at or
above the field's target, and partial credit in proportion below it. A *neutral* answer (3 out of 5) is level 0.5,
so it already earned 60-80 % of the credit for most targets. Measured with the original Python engine:

| Answer pattern | Highest field score | Fields with a "strong" band (>= 75) |
|---|---|---|
| Every answer = 3 (neutral) | 78.9 | 4 of 19 |
| Every answer = 5 | 100 | 19 of 19 |

So a student who gave no real signal could still be told that a field was a "strong match".

**Change.** A neutral answer now gives **no positive evidence**: its fit is 0 on every dimension.

* Interests, skills, values, learning ("more is fine"):
  `evidence = max(0, (level - 0.5) / 0.5)` (answer 3 -> 0, 4 -> 0.5, 5 -> 1);
  `targetEvidence = clamp((target - 0.5) / 0.5, 0.25, 1)`; `fit = min(1, evidence / targetEvidence)`.
  The floor (0.25, `evidence_floor` in the config) means that even a field with a mild requirement needs real agreement.
* Preferences (team vs. independent etc.): `fit = 1 - |level - target|`, but 0 when the answer is neutral.
* Group weights, field profiles, targets, the diversity rule and the band thresholds are **unchanged**.
* `strength_min_fit` for explanations was lowered from 0.85 to 0.80 because answer 4 against a 0.8 target now gives 0.83.

**Effect (current engine).**

| Answer pattern | Highest field score |
|---|---|
| Every answer = 3 | **0** (every field) |
| Every answer = 1 | 9.5 |
| Every answer = 5 | 100, with the `flat_profile` warning |

Scores for realistic profiles change too (they are generally lower and more spread out), so **v0.2 scores are not
comparable with v0.1 scores**. The old numbers are not preserved.

**Verification.**
* `tests/scoring.test.js` has "NEUTRAL FIX" tests (all-neutral -> all fields 0; neutral never scores higher than agreement;
  no "strong" band without clear agreement).
* `fit_mode: "legacy"` still reproduces v0.1. The test "PARITY" compares the JavaScript engine in legacy mode with
  133 scores produced by the original Python code (`tests/fixtures/python_v1_golden.json`) and requires exact equality.
  This proves the port did not change the arithmetic; only the new default mode does.

**Known limitations that remain.**
* **Agreeing with everything** (all 4s or 5s) still matches every field. The engine cannot separate "likes everything"
  from "likes these things". It shows the `flat_profile` warning, but a fix needs a different design
  (e.g. forced ranking, or centering each student's answers) and ideally real data.
* **Band thresholds (75 / 60) were not recalibrated.** They are arbitrary. Choose them from the distribution of real
  responses once you have collected some.
* **The field profiles (targets and weights) are unreviewed first drafts.**
* **One question per dimension** means each dimension is measured by a single self-rating, which is statistically weak.
* The diversity rule can show a field with a lower score in the top 3 than a field listed under "other fields".
  The interface says so openly ("ranks #N by score alone"), and `full_ranking` / `overall_rank` keep the pure order.
  Set `selection.max_per_family` to 19 in `scoring_config.json` to switch the rule off.

## v0.1.0-draft (original Python prototype, kept in `legacy-python/`)

`fit = min(1, level / target)` for interests, skills, values and learning; `fit = 1 - |level - target|` for preferences.
