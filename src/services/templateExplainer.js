'use strict';
/**
 * templateExplainer.js - turns the scoring breakdown into readable text
 * (English / Arabic) WITHOUT any AI.
 *
 * The text is built ONLY from the numbers the scoring engine already produced
 * (which dimensions added points, which lost points), so it can never claim
 * something the calculation did not find. It is also the fallback shown when
 * Gemini is not configured or fails.
 */

const DISCLAIMER = {
  en: 'This result is an exploration tool, not a professional diagnosis or a guarantee of career success.',
  ar: 'هذه النتيجة أداة للاستكشاف، وليست تشخيصًا مهنيًا أو ضمانًا للنجاح الوظيفي.',
};

const SCORE_LABEL = { en: 'Compatibility score', ar: 'درجة التوافق' };

const SCORE_NOTE = {
  en: 'The score shows how closely your answers match a field profile used in this prototype. It is not a probability and does not measure your ability.',
  ar: 'تبيّن الدرجة مدى تطابق إجاباتك مع ملف المجال المستخدم في هذا النموذج الأولي. وهي ليست احتمالًا ولا تقيس قدراتك.',
};

const BAND_LABEL = {
  strong: { en: 'Strong match to explore', ar: 'توافق قوي يستحق الاستكشاف' },
  moderate: { en: 'Moderate match', ar: 'توافق متوسط' },
  exploratory: { en: 'Worth a look', ar: 'يستحق الاطلاع' },
};

const WARNING_TEXT = {
  flat_profile: {
    en: 'Your answers were very similar across most questions, so it is hard to tell fields apart. Consider retaking the assessment and using the full range of the scale.',
    ar: 'كانت إجاباتك متقاربة جدًا في معظم الأسئلة، لذلك يصعب التمييز بين المجالات. يمكنك إعادة التقييم واستخدام كامل نطاق المقياس.',
  },
  close_scores: {
    en: 'Your top fields scored very close to each other, so please treat them as roughly equal rather than a strict order.',
    ar: 'جاءت درجات أعلى المجالات متقاربة جدًا، لذا اعتبرها متساوية تقريبًا وليست ترتيبًا صارمًا.',
  },
};

/** 'a, b and c' in English; 'أ، ب و ج' in Arabic. */
function joinList(items, lang) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  const head = items.slice(0, -1);
  const last = items[items.length - 1];
  return lang === 'ar' ? `${head.join('، ')} و${last}` : `${head.join(', ')} and ${last}`;
}

class TemplateExplainer {
  /** @param {object} content - the object returned by scoringService.loadContent() */
  constructor(content) {
    this.content = content;
  }

  label(dimensionId, lang) {
    return this.content.questionsDoc.dimensions[dimensionId][`label_${lang}`];
  }

  pole(dimensionId, pole, lang) {
    return this.content.questionsDoc.dimensions[dimensionId][`${pole}_${lang}`];
  }

  strengthText(c, lang) {
    if (c.group === 'preferences') {
      const phrase = this.pole(c.dimension, c.student_level > 0.5 ? 'high' : 'low', lang);
      return lang === 'en' ? `preference for ${phrase}` : `تفضيل ${phrase}`;
    }
    return this.label(c.dimension, lang);
  }

  gapText(c, lang) {
    if (c.group === 'preferences') return this.pole(c.dimension, c.target > 0.5 ? 'high' : 'low', lang);
    return this.label(c.dimension, lang);
  }

  /**
   * Structured explanation: { strengths: [labels], gaps: [labels], text }.
   * The UI shows the labels as chips; `text` is the readable paragraph.
   */
  explainFieldParts(fieldResult, lang) {
    const cfg = this.content.config.explanation;

    // A "strength" must be a good fit AND something the student actually showed.
    const isStrength = (c) => {
      if (c.fit < cfg.strength_min_fit) return false;
      if (c.group === 'preferences') return Math.abs(c.student_level - 0.5) >= cfg.strength_min_preference_clarity;
      return c.student_level >= cfg.strength_min_level;
    };
    const byPointsDesc = (a, b) => b.points - a.points || (a.dimension < b.dimension ? -1 : 1);
    const byLostDesc = (a, b) => b.points_lost - a.points_lost || (a.dimension < b.dimension ? -1 : 1);

    const strengths = fieldResult.contributions.filter(isStrength).sort(byPointsDesc).slice(0, cfg.max_strengths);
    const gaps = fieldResult.contributions.filter((c) => c.fit < cfg.gap_max_fit).sort(byLostDesc).slice(0, cfg.max_gaps);

    const strengthLabels = strengths.map((c) => this.strengthText(c, lang));
    const gapLabels = gaps.map((c) => this.gapText(c, lang));

    const parts = [];
    if (strengthLabels.length) {
      const items = joinList(strengthLabels, lang);
      parts.push(
        lang === 'ar'
          ? `بناءً على إجاباتك، يبدو أن هذا المجال يستحق الاستكشاف بسبب: ${items}.`
          : `Based on your answers, this field appears worth exploring because of: ${items}.`
      );
    } else {
      parts.push(
        lang === 'ar'
          ? 'تتداخل إجاباتك مع هذا المجال جزئيًا فقط، لذا اعتبره خيارًا للاستكشاف وليس توافقًا قويًا.'
          : 'Your answers only partly overlap with this field, so treat it as an option to explore, not a strong match.'
      );
    }
    if (gapLabels.length) {
      const items = joinList(gapLabels, lang);
      parts.push(
        lang === 'ar'
          ? `نقاط تستحق التحقق قبل أن تقرّر (كانت إجاباتك فيها أضعف أو تتجه في اتجاه مختلف): ${items}.`
          : `Points to check before deciding (your answers were weaker or pointed another way): ${items}.`
      );
    }
    return { strengths: strengthLabels, gaps: gapLabels, text: parts.join(' ') };
  }

  explainField(fieldResult, lang) {
    return this.explainFieldParts(fieldResult, lang).text;
  }

  /** Readable lists for the "Your strongest areas" section. */
  explainProfile(profileSummary, lang) {
    const labels = (key) => profileSummary[key].map((i) => this.label(i.dimension, lang));
    return {
      interests: labels('top_interests'),
      skills: labels('top_skills'),
      preferences: profileSummary.preferences.map((p) => this.pole(p.dimension, p.pole, lang)),
      values: labels('top_values'),
      learning: labels('top_learning'),
    };
  }

  warningText(code, lang) {
    return WARNING_TEXT[code][lang];
  }
}

module.exports = { TemplateExplainer, DISCLAIMER, SCORE_LABEL, SCORE_NOTE, BAND_LABEL, WARNING_TEXT, joinList };
