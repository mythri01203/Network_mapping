/**
 * Voice lesson scripts (learning assistant, Stage 1). The server generates audio only from these
 * texts, never from text a browser sends, so the Sarvam key cannot be used for anything else.
 *
 * Telugu and Kannada are drafts until a native speaker checks them (`reviewed: false`). A clip made
 * from a draft stays a draft: it is never played to field users, and English is never played in
 * its place.
 */

export const VOICE_LANGUAGES = ['en', 'te', 'kn'] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

/** Sarvam language codes. */
export const SARVAM_LANGUAGE_CODES: Record<VoiceLanguage, string> = { en: 'en-IN', te: 'te-IN', kn: 'kn-IN' };

/** Sarvam takes at most 2500 characters per request. */
export const MAX_SCRIPT_CHARS = 2500;

export interface ScriptText {
  text: string;
  /** Checked by a native speaker (always true for English, which is the source). */
  reviewed: boolean;
}

export interface LessonScript {
  /** Stable id: `<lesson>.<step>`, also the audio key. */
  key: string;
  title: string;
  text: Record<VoiceLanguage, ScriptText>;
  /** Equipment names kept in English beside the words, such as OLT and ONT. */
  terms?: readonly string[];
}

const draft = (text: string): ScriptText => ({ text, reviewed: false });
const english = (text: string): ScriptText => ({ text, reviewed: true });

export const LESSON_SCRIPTS: readonly LessonScript[] = [
  {
    key: 'welcome.intro',
    title: 'Welcome',
    text: {
      en: {
        text: "Welcome to FiberGIS. I will show you how to use this application step by step. You can watch the demonstrations and listen to the instructions. Let's start learning.",
        reviewed: true,
      },
      te: {
        text: 'ఫైబర్ జీఐఎస్‌కు స్వాగతం. ఈ యాప్‌ను ఎలా వాడాలో నేను మీకు దశలవారీగా చూపిస్తాను. మీరు చూపించే ఉదాహరణలను చూడవచ్చు, సూచనలను వినవచ్చు. నేర్చుకోవడం మొదలుపెడదాం.',
        reviewed: false,
      },
      kn: {
        text: 'ಫೈಬರ್ ಜಿಐಎಸ್‌ಗೆ ಸ್ವಾಗತ. ಈ ಆ್ಯಪ್ ಅನ್ನು ಹೇಗೆ ಬಳಸುವುದು ಎಂದು ನಾನು ನಿಮಗೆ ಹಂತ ಹಂತವಾಗಿ ತೋರಿಸುತ್ತೇನೆ. ತೋರಿಸುವ ಉದಾಹರಣೆಗಳನ್ನು ನೋಡಬಹುದು, ಸೂಚನೆಗಳನ್ನು ಕೇಳಬಹುದು. ಕಲಿಯಲು ಶುರು ಮಾಡೋಣ.',
        reviewed: false,
      },
    },
  },
  {
    key: 'welcome.what',
    title: 'What FiberGIS is',
    text: {
      en: english('FiberGIS is a map of our internet network. It shows where every box, pole and cable is, so the team can find them and fix problems quickly.'),
      te: draft('ఫైబర్ జీఐఎస్ అంటే మన ఇంటర్నెట్ నెట్‌వర్క్ మ్యాప్. ప్రతి బాక్స్, స్తంభం, కేబుల్ ఎక్కడ ఉందో ఇది చూపిస్తుంది. అందువల్ల మన టీమ్ వాటిని సులభంగా కనుగొని, సమస్యలను త్వరగా సరిచేయగలదు.'),
      kn: draft('ಫೈಬರ್ ಜಿಐಎಸ್ ಅಂದರೆ ನಮ್ಮ ಇಂಟರ್ನೆಟ್ ನೆಟ್‌ವರ್ಕ್‌ನ ನಕ್ಷೆ. ಪ್ರತಿ ಬಾಕ್ಸ್, ಕಂಬ ಮತ್ತು ಕೇಬಲ್ ಎಲ್ಲಿದೆ ಎಂದು ಇದು ತೋರಿಸುತ್ತದೆ. ಹೀಗಾಗಿ ನಮ್ಮ ತಂಡ ಅವುಗಳನ್ನು ಸುಲಭವಾಗಿ ಹುಡುಕಿ, ಸಮಸ್ಯೆಗಳನ್ನು ಬೇಗ ಸರಿಪಡಿಸಬಹುದು.'),
    },
  },
  {
    key: 'welcome.map',
    title: 'The map',
    text: {
      en: english('On the map, each small picture is a piece of equipment, like a pole or a box. Each coloured line is a fiber cable. Tap a picture to see its details.'),
      te: draft('మ్యాప్‌లో ప్రతి చిన్న బొమ్మ ఒక పరికరం, ఉదాహరణకు స్తంభం లేదా బాక్స్. ప్రతి రంగు గీత ఒక ఫైబర్ కేబుల్. వివరాలు చూడాలంటే బొమ్మను నొక్కండి.'),
      kn: draft('ನಕ್ಷೆಯಲ್ಲಿ ಪ್ರತಿ ಚಿಕ್ಕ ಚಿತ್ರ ಒಂದು ಉಪಕರಣ, ಉದಾಹರಣೆಗೆ ಕಂಬ ಅಥವಾ ಬಾಕ್ಸ್. ಪ್ರತಿ ಬಣ್ಣದ ಗೆರೆ ಒಂದು ಫೈಬರ್ ಕೇಬಲ್. ವಿವರ ನೋಡಲು ಚಿತ್ರವನ್ನು ಒತ್ತಿ.'),
    },
  },
  {
    key: 'welcome.path',
    title: 'How internet reaches a home',
    terms: ['OLT', 'Fiber cable', 'Box', 'ONT'],
    text: {
      en: english("Internet starts at the main office, in a machine called the OLT. It travels through fiber cables and boxes on poles, and reaches a small box called the ONT inside the customer's home."),
      te: draft('ఇంటర్నెట్ మెయిన్ ఆఫీసులో ఉన్న ఓఎల్‌టీ అనే యంత్రం నుండి మొదలవుతుంది. అది ఫైబర్ కేబుళ్లు, స్తంభాలపై ఉన్న బాక్సుల ద్వారా ప్రయాణించి, కస్టమర్ ఇంట్లో ఉన్న ఓఎన్‌టీ అనే చిన్న బాక్స్‌కు చేరుతుంది.'),
      kn: draft('ಇಂಟರ್ನೆಟ್ ಮುಖ್ಯ ಕಚೇರಿಯಲ್ಲಿರುವ ಒಎಲ್‌ಟಿ ಎಂಬ ಯಂತ್ರದಿಂದ ಶುರುವಾಗುತ್ತದೆ. ಅದು ಫೈಬರ್ ಕೇಬಲ್‌ಗಳು ಮತ್ತು ಕಂಬಗಳ ಮೇಲಿನ ಬಾಕ್ಸ್‌ಗಳ ಮೂಲಕ ಸಾಗಿ, ಗ್ರಾಹಕರ ಮನೆಯೊಳಗಿನ ಒಎನ್‌ಟಿ ಎಂಬ ಚಿಕ್ಕ ಬಾಕ್ಸ್ ತಲುಪುತ್ತದೆ.'),
    },
  },
  {
    key: 'welcome.again',
    title: 'Watch again any time',
    text: {
      en: english('You can watch this again at any time. Open Help, the question mark button, and choose Learn FiberGIS.'),
      te: draft('దీన్ని ఎప్పుడైనా మళ్లీ చూడవచ్చు. ప్రశ్న గుర్తు ఉన్న హెల్ప్ బటన్‌ను నొక్కి, లెర్న్ ఫైబర్ జీఐఎస్ ఎంచుకోండి.'),
      kn: draft('ಇದನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ಮತ್ತೆ ನೋಡಬಹುದು. ಪ್ರಶ್ನೆ ಚಿಹ್ನೆಯ ಹೆಲ್ಪ್ ಬಟನ್ ಒತ್ತಿ, ಲರ್ನ್ ಫೈಬರ್ ಜಿಐಎಸ್ ಆಯ್ಕೆ ಮಾಡಿ.'),
    },
  },
];

/** The welcome lesson, in order. */
export const WELCOME_LESSON = ['welcome.intro', 'welcome.what', 'welcome.map', 'welcome.path', 'welcome.again'] as const;

export const isVoiceLanguage = (value: unknown): value is VoiceLanguage => typeof value === 'string' && (VOICE_LANGUAGES as readonly string[]).includes(value);

export function lessonScript(key: string): LessonScript | undefined {
  return LESSON_SCRIPTS.find((s) => s.key === key);
}

/** What a voice clip record looks like to the browser. */
export interface VoiceClip {
  id: string;
  lessonKey: string;
  language: VoiceLanguage;
  /** Hash of the exact words, voice and model: a changed script needs a new clip. */
  scriptHash: string;
  model: string;
  voice: string;
  characters: number;
  bytes: number;
  format: 'mp3' | 'wav';
  /** draft: not played to field users. approved: checked; for Telugu and Kannada by a native speaker. */
  status: 'draft' | 'approved' | 'rejected';
  createdAt: string;
  createdBy: string | null;
  reviewedAt?: string;
  reviewedBy?: string;
  /** The words have changed since this clip was made, so it no longer matches. */
  outdated?: boolean;
}
