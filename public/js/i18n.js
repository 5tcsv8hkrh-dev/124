/*
 * i18n.js - all interface text in English and Arabic.
 *
 * To change a sentence, edit it here. To add a language, add another block with the
 * same keys (the tests check that English and Arabic have exactly the same keys).
 * Texts that belong to the questionnaire and the fields live in src/data/*.json.
 *
 * Use {name} for values that are filled in later, e.g. "Question {n} of {total}".
 */
(function () {
  'use strict';

  var STRINGS = {
    en: {
      app_name: 'Masarat',
      skip_link: 'Skip to main content',
      lang_group_label: 'Language',
      doc_title: 'Masarat - explore fields that may fit you',

      // Home
      home_title: 'Discover fields that may fit your interests, strengths, and preferences.',
      home_lead: 'Answer 27 short questions. You will get several fields to explore, the reasons they came up, and practical next steps. There is no single "right" answer for you.',
      start_button: 'Start the assessment',
      home_facts_title: 'Before you start',
      fact_time_title: 'About 8 minutes',
      fact_time_text: '27 questions, one at a time. You can go back and change an answer.',
      fact_result_title: 'Several options, not one',
      fact_result_text: 'Your results list fields to explore with reasons, subjects, example majors and questions to ask yourself.',
      fact_privacy_title: 'Nothing personal is stored',
      fact_privacy_text: 'We do not ask for your name, email or any personal details, and your answers are not saved on the server.',
      ai_option_label: 'Use AI-written explanations (optional)',
      ai_option_help: 'If you keep this on, only your anonymous ratings and the field scores are sent to Google Gemini to write the explanations. No name or text you typed is sent, because the app has no free-text boxes. If you turn it off, the app writes the explanations itself.',
      prototype_note: 'This is a research prototype. It is not a psychological test or a professional career assessment, and it has not been scientifically validated.',

      // Assessment
      progress_count: 'Question {n} of {total}',
      progress_label: 'Assessment progress',
      back: 'Back',
      next: 'Next',
      finish: 'See my results',
      answer_required: 'Please choose an answer to continue.',
      in_between: 'In between',
      bipolar_1: 'Strongly prefer: {low}',
      bipolar_2: 'Lean toward: {low}',
      bipolar_3: 'In between',
      bipolar_4: 'Lean toward: {high}',
      bipolar_5: 'Strongly prefer: {high}',
      scale_hint_agree: 'How much do you agree?',
      scale_hint_bipolar: 'Where do you fall between these two?',

      // Loading
      loading_title: 'Finding fields for you to explore',
      loading_text: 'Working out which fields match your answers. This can take a few seconds if AI explanations are on.',
      loading_questions: 'Loading the questions',

      // Results
      results_title: 'Your results',
      results_lead: 'These are fields that may be worth exploring, based only on your answers. Read the reasons, compare the options, and keep an open mind.',
      areas_title: 'Your strongest areas',
      areas_interests: 'Interests',
      areas_skills: 'Strengths you see in yourself',
      areas_preferences: 'How you like to work',
      areas_values: 'What matters to you',
      areas_learning: 'How you learn best',
      areas_none: 'No single area stood out strongly in your answers.',
      recommended_title: 'Fields to explore first',
      ai_overview_title: 'Overview',
      score_out_of: '{score} out of 100',
      score_meter_label: '{label}: {score} out of 100',
      why_title: 'Why this field appeared',
      matched_title: 'Matched your answers',
      check_title: 'Points to check',
      built_title: 'How this score was built',
      built_item: '{label}: you answered {answer} of 5 (+{points} points)',
      ai_suggestions_title: 'Suggestions (written by AI)',
      next_steps_title: 'Practical next steps',
      steps_subjects: 'Subjects to explore',
      steps_majors: 'Example university majors',
      steps_careers: 'Example careers',
      steps_skills: 'Skills to build',
      steps_activities: 'Try this',
      steps_questions: 'Questions to ask yourself',
      related_title: 'Related fields',
      pure_rank_note: 'By score alone this field ranks #{n}. It is shown here so that your top choices cover a wider range.',
      alt_title: 'Other fields worth exploring',
      alt_intro: 'These scored well too, or are related to your top fields. Open any of them to see more.',
      badge_ai: 'Written by AI',
      badge_template: 'Written by the built-in system',
      ai_status_used: 'The explanations below were written with AI (Google Gemini) from your anonymous ratings. The scores and order come from the transparent scoring system, not from the AI.',
      ai_status_disabled: 'The explanations below were written by the built-in system, as you chose.',
      ai_status_fallback: 'The explanations below were written by the built-in system. {reason}',
      ai_reason_not_configured: 'AI explanations are not set up on this server.',
      ai_reason_timeout: 'The AI took too long to answer.',
      ai_reason_rate_limited: 'The AI service is busy right now.',
      ai_reason_auth: 'The AI service could not be used on this server.',
      ai_reason_invalid_response: 'The AI answer did not pass our safety checks.',
      ai_reason_unavailable: 'The AI service was not available.',
      restart: 'Start again',
      score_method_note: 'How scores work: your answers are compared with a profile for each field. A neutral answer adds nothing; clear agreement adds points. The profiles are first drafts that experts have not yet reviewed.',

      // Errors
      error_title: 'Something went wrong',
      error_generic: 'We could not complete that. Please try again.',
      error_network: 'We could not reach the server. Check your internet connection and that the app is running, then try again.',
      error_rate_limited: 'You have made too many requests. Please wait a minute and try again.',
      error_invalid: 'Some answers were missing or not valid. Please go back and check them.',
      error_questions: 'We could not load the questions. Please try again.',
      try_again: 'Try again',
      back_home: 'Back to start',

      // Footer
      footer_disclaimer: 'This result is an exploration tool, not a professional diagnosis or a guarantee of career success.',
      footer_privacy: 'No personal information is requested or stored.'
    },

    ar: {
      app_name: 'مسارات',
      skip_link: 'تخطَّ إلى المحتوى الرئيسي',
      lang_group_label: 'اللغة',
      doc_title: 'مسارات - اكتشف المجالات التي قد تناسبك',

      home_title: 'اكتشف المجالات التي قد تناسب اهتماماتك ونقاط قوتك وتفضيلاتك.',
      home_lead: 'أجب عن 27 سؤالًا قصيرًا، وستحصل على عدة مجالات تستحق الاستكشاف، وأسباب ظهورها، وخطوات عملية تالية. ليس هناك إجابة «صحيحة» واحدة لك.',
      start_button: 'ابدأ التقييم',
      home_facts_title: 'قبل أن تبدأ',
      fact_time_title: 'نحو 8 دقائق',
      fact_time_text: '27 سؤالًا، سؤال في كل مرة. يمكنك الرجوع وتغيير أي إجابة.',
      fact_result_title: 'عدة خيارات لا خيار واحد',
      fact_result_text: 'تعرض نتائجك مجالات للاستكشاف مع الأسباب والمواد والتخصصات الجامعية المقترحة وأسئلة تسألها لنفسك.',
      fact_privacy_title: 'لا نحفظ أي معلومات شخصية',
      fact_privacy_text: 'لا نطلب اسمك ولا بريدك الإلكتروني ولا أي بيانات شخصية، ولا تُحفظ إجاباتك على الخادم.',
      ai_option_label: 'استخدام شروحات يكتبها الذكاء الاصطناعي (اختياري)',
      ai_option_help: 'إذا أبقيت هذا الخيار مفعّلًا، فسيُرسَل إلى Google Gemini تقييماتك المجهولة ودرجات المجالات فقط لكتابة الشروحات. لا يُرسَل أي اسم أو نص كتبته، لأن التطبيق لا يحتوي على مربعات نص حر. وإذا ألغيته فسيكتب التطبيق الشروحات بنفسه.',
      prototype_note: 'هذا نموذج أولي بحثي. وهو ليس اختبارًا نفسيًا ولا تقييمًا مهنيًا محترفًا، ولم يتم التحقق من صحته علميًا بعد.',

      progress_count: 'السؤال {n} من {total}',
      progress_label: 'تقدّم التقييم',
      back: 'السابق',
      next: 'التالي',
      finish: 'اعرض نتائجي',
      answer_required: 'يرجى اختيار إجابة للمتابعة.',
      in_between: 'بين الاثنين',
      bipolar_1: 'أفضّل بقوة: {low}',
      bipolar_2: 'أميل إلى: {low}',
      bipolar_3: 'بين الاثنين',
      bipolar_4: 'أميل إلى: {high}',
      bipolar_5: 'أفضّل بقوة: {high}',
      scale_hint_agree: 'إلى أي مدى توافق؟',
      scale_hint_bipolar: 'أين تقع بين هذين الخيارين؟',

      loading_title: 'نبحث عن مجالات تستحق أن تستكشفها',
      loading_text: 'نحدد المجالات المتوافقة مع إجاباتك. قد يستغرق ذلك بضع ثوانٍ إذا كانت شروحات الذكاء الاصطناعي مفعّلة.',
      loading_questions: 'جارٍ تحميل الأسئلة',

      results_title: 'نتائجك',
      results_lead: 'هذه مجالات قد يستحق استكشافها، اعتمادًا على إجاباتك فقط. اقرأ الأسباب وقارن بين الخيارات وابقَ منفتح الذهن.',
      areas_title: 'أقوى جوانبك',
      areas_interests: 'الاهتمامات',
      areas_skills: 'نقاط القوة التي تراها في نفسك',
      areas_preferences: 'طريقتك المفضلة في العمل',
      areas_values: 'ما يهمّك',
      areas_learning: 'طريقتك الأفضل في التعلّم',
      areas_none: 'لم يبرز جانب واحد بوضوح في إجاباتك.',
      recommended_title: 'مجالات تبدأ باستكشافها',
      ai_overview_title: 'نظرة عامة',
      score_out_of: '{score} من 100',
      score_meter_label: '{label}: {score} من 100',
      why_title: 'لماذا ظهر هذا المجال',
      matched_title: 'ما تطابق مع إجاباتك',
      check_title: 'نقاط تستحق التحقق',
      built_title: 'كيف حُسبت هذه الدرجة',
      built_item: '{label}: أجبت {answer} من 5 (+{points} نقطة)',
      ai_suggestions_title: 'اقتراحات (كتبها الذكاء الاصطناعي)',
      next_steps_title: 'خطوات عملية تالية',
      steps_subjects: 'مواد تستحق الاستكشاف',
      steps_majors: 'أمثلة على التخصصات الجامعية',
      steps_careers: 'أمثلة على المهن',
      steps_skills: 'مهارات يمكنك تنميتها',
      steps_activities: 'جرّب هذا',
      steps_questions: 'أسئلة اسألها لنفسك',
      related_title: 'مجالات ذات صلة',
      pure_rank_note: 'بحسب الدرجة وحدها يأتي هذا المجال في المرتبة {n}. ظهر هنا حتى تغطي خياراتك الأولى نطاقًا أوسع.',
      alt_title: 'مجالات أخرى تستحق الاستكشاف',
      alt_intro: 'حصلت هذه المجالات على درجات جيدة أيضًا أو ترتبط بمجالاتك الأولى. افتح أيًّا منها لترى المزيد.',
      badge_ai: 'كتبه الذكاء الاصطناعي',
      badge_template: 'كتبه النظام المدمج',
      ai_status_used: 'كُتبت الشروحات أدناه بمساعدة الذكاء الاصطناعي (Google Gemini) اعتمادًا على تقييماتك المجهولة. أما الدرجات والترتيب فمن نظام الحساب الشفاف وليس من الذكاء الاصطناعي.',
      ai_status_disabled: 'كُتبت الشروحات أدناه بواسطة النظام المدمج، بحسب اختيارك.',
      ai_status_fallback: 'كُتبت الشروحات أدناه بواسطة النظام المدمج. {reason}',
      ai_reason_not_configured: 'شروحات الذكاء الاصطناعي غير مفعّلة على هذا الخادم.',
      ai_reason_timeout: 'استغرق الذكاء الاصطناعي وقتًا طويلًا في الرد.',
      ai_reason_rate_limited: 'خدمة الذكاء الاصطناعي مشغولة حاليًا.',
      ai_reason_auth: 'تعذّر استخدام خدمة الذكاء الاصطناعي على هذا الخادم.',
      ai_reason_invalid_response: 'لم تجتز إجابة الذكاء الاصطناعي فحوصات السلامة لدينا.',
      ai_reason_unavailable: 'لم تكن خدمة الذكاء الاصطناعي متاحة.',
      restart: 'ابدأ من جديد',
      score_method_note: 'كيف تعمل الدرجات: تُقارَن إجاباتك بملف خاص بكل مجال. الإجابة المحايدة لا تضيف شيئًا، والموافقة الواضحة تضيف نقاطًا. هذه الملفات مسودات أولى لم يراجعها الخبراء بعد.',

      error_title: 'حدث خطأ ما',
      error_generic: 'تعذّر إكمال ذلك. يرجى المحاولة مرة أخرى.',
      error_network: 'تعذّر الوصول إلى الخادم. تحقق من اتصالك بالإنترنت ومن أن التطبيق يعمل، ثم حاول مرة أخرى.',
      error_rate_limited: 'أرسلت طلبات كثيرة. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.',
      error_invalid: 'بعض الإجابات ناقصة أو غير صالحة. يرجى الرجوع ومراجعتها.',
      error_questions: 'تعذّر تحميل الأسئلة. يرجى المحاولة مرة أخرى.',
      try_again: 'حاول مرة أخرى',
      back_home: 'العودة إلى البداية',

      footer_disclaimer: 'هذه النتيجة أداة للاستكشاف، وليست تشخيصًا مهنيًا أو ضمانًا للنجاح الوظيفي.',
      footer_privacy: 'لا نطلب أي معلومات شخصية ولا نحفظها.'
    }
  };

  /** Look up a string and fill in {placeholders}. Falls back to English, then to the key. */
  function t(lang, key, params) {
    var table = STRINGS[lang] || STRINGS.en;
    var text = table[key];
    if (text === undefined) text = STRINGS.en[key];
    if (text === undefined) return key;
    if (params) {
      Object.keys(params).forEach(function (name) {
        text = text.split('{' + name + '}').join(String(params[name]));
      });
    }
    return text;
  }

  var api = { STRINGS: STRINGS, t: t };

  if (typeof module !== 'undefined' && module.exports) module.exports = api; // for the tests
  if (typeof window !== 'undefined') {
    window.CE = window.CE || {};
    window.CE.i18n = api;
  }
})();
