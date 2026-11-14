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
      en: english(
        'FiberGIS is a map of our internet network. It shows where every box, pole and cable is, so the team can find them and fix problems quickly.',
      ),
      te: draft(
        'FiberGIS అంటే మన ఇంటర్నెట్ నెట్‌వర్క్ మ్యాప్. ప్రతి box, pole, cable ఎక్కడ ఉందో ఇది చూపిస్తుంది. అందువల్ల మన టీమ్ వాటిని సులభంగా కనుగొని, సమస్యలను త్వరగా సరిచేయగలదు.',
      ),
      kn: draft(
        'ಫೈಬರ್ ಜಿಐಎಸ್ ಅಂದರೆ ನಮ್ಮ ಇಂಟರ್ನೆಟ್ ನೆಟ್‌ವರ್ಕ್‌ನ ನಕ್ಷೆ. ಪ್ರತಿ ಬಾಕ್ಸ್, ಕಂಬ ಮತ್ತು ಕೇಬಲ್ ಎಲ್ಲಿದೆ ಎಂದು ಇದು ತೋರಿಸುತ್ತದೆ. ಹೀಗಾಗಿ ನಮ್ಮ ತಂಡ ಅವುಗಳನ್ನು ಸುಲಭವಾಗಿ ಹುಡುಕಿ, ಸಮಸ್ಯೆಗಳನ್ನು ಬೇಗ ಸರಿಪಡಿಸಬಹುದು.',
      ),
    },
  },
  {
    key: 'welcome.map',
    title: 'The map',
    text: {
      en: english(
        'On the map, each small picture is a piece of equipment, like a pole or a box. Each coloured line is a fiber cable. Tap a picture to see its details.',
      ),
      te: draft(
        'మ్యాప్‌లో ప్రతి చిన్న బొమ్మ ఒక పరికరం, ఉదాహరణకు pole లేదా box. ప్రతి రంగు గీత ఒక fiber cable. వివరాలు చూడాలంటే బొమ్మను నొక్కండి.',
      ),
      kn: draft(
        'ನಕ್ಷೆಯಲ್ಲಿ ಪ್ರತಿ ಚಿಕ್ಕ ಚಿತ್ರ ಒಂದು ಉಪಕರಣ, ಉದಾಹರಣೆಗೆ ಕಂಬ ಅಥವಾ ಬಾಕ್ಸ್. ಪ್ರತಿ ಬಣ್ಣದ ಗೆರೆ ಒಂದು ಫೈಬರ್ ಕೇಬಲ್. ವಿವರ ನೋಡಲು ಚಿತ್ರವನ್ನು ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'welcome.path',
    title: 'How internet reaches a home',
    terms: ['OLT', 'Fiber cable', 'Box', 'ONT'],
    text: {
      en: english(
        "Internet starts at the main office, in a machine called the OLT. It travels through fiber cables and boxes on poles, and reaches a small box called the ONT inside the customer's home.",
      ),
      te: draft(
        'ఇంటర్నెట్ మెయిన్ ఆఫీసులో ఉన్న OLT అనే యంత్రం నుండి మొదలవుతుంది. అది fiber cables, polesపై ఉన్న boxes ద్వారా ప్రయాణించి, కస్టమర్ ఇంట్లో ఉన్న ONT అనే చిన్న boxకు చేరుతుంది.',
      ),
      kn: draft(
        'ಇಂಟರ್ನೆಟ್ ಮುಖ್ಯ ಕಚೇರಿಯಲ್ಲಿರುವ ಒಎಲ್‌ಟಿ ಎಂಬ ಯಂತ್ರದಿಂದ ಶುರುವಾಗುತ್ತದೆ. ಅದು ಫೈಬರ್ ಕೇಬಲ್‌ಗಳು ಮತ್ತು ಕಂಬಗಳ ಮೇಲಿನ ಬಾಕ್ಸ್‌ಗಳ ಮೂಲಕ ಸಾಗಿ, ಗ್ರಾಹಕರ ಮನೆಯೊಳಗಿನ ಒಎನ್‌ಟಿ ಎಂಬ ಚಿಕ್ಕ ಬಾಕ್ಸ್ ತಲುಪುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'welcome.again',
    title: 'Watch again any time',
    text: {
      en: english(
        'You can watch this again at any time. Open Help, the question mark button, and choose Learn FiberGIS.',
      ),
      te: draft(
        'దీన్ని ఎప్పుడైనా మళ్లీ చూడవచ్చు. ప్రశ్న గుర్తు ఉన్న హెల్ప్ బటన్‌ను నొక్కి, లెర్న్ FiberGIS ఎంచుకోండి.',
      ),
      kn: draft(
        'ಇದನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ಮತ್ತೆ ನೋಡಬಹುದು. ಪ್ರಶ್ನೆ ಚಿಹ್ನೆಯ ಹೆಲ್ಪ್ ಬಟನ್ ಒತ್ತಿ, ಲರ್ನ್ ಫೈಬರ್ ಜಿಐಎಸ್ ಆಯ್ಕೆ ಮಾಡಿ.',
      ),
    },
  },
  // On-screen guide (learning assistant, Stage 3): a tour of every menu page, and mapping the FTTH flow step by step.
  {
    key: 'menu.intro',
    title: 'Tour of every page',
    text: {
      en: english(
        'I will take you to every page of the menu, one by one. Just watch and listen. Tap Pause to stop, and Back to hear a page again.',
      ),
      te: draft(
        'మెనూలోని ప్రతి పేజీకి ఒక్కొక్కటిగా తీసుకెళ్తాను. చూస్తూ వినండి. ఆపాలంటే Pause, ఒక పేజీ మళ్లీ వినాలంటే Back నొక్కండి.',
      ),
      kn: draft(
        'ಮೆನುವಿನ ಪ್ರತಿ ಪುಟಕ್ಕೆ ಒಂದೊಂದಾಗಿ ಕರೆದೊಯ್ಯುತ್ತೇನೆ. ನೋಡುತ್ತಾ ಕೇಳಿ. ನಿಲ್ಲಿಸಲು Pause, ಒಂದು ಪುಟವನ್ನು ಮತ್ತೆ ಕೇಳಲು Back ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'menu.map',
    title: 'Network Map',
    text: {
      en: english(
        'This is the Network Map. It shows all your equipment, cables and customers on the real map. You place new equipment and draw cables here.',
      ),
      te: draft(
        'ఇది Network Map. మీ పరికరాలు, cables, కస్టమర్లు అన్నీ అసలు మ్యాప్‌పై కనిపిస్తాయి. కొత్త పరికరాలు పెట్టడం, cables గీయడం ఇక్కడే.',
      ),
      kn: draft(
        'ಇದು Network Map. ನಿಮ್ಮ ಉಪಕರಣಗಳು, ಕೇಬಲ್‌ಗಳು, ಗ್ರಾಹಕರು ಎಲ್ಲಾ ನಿಜವಾದ ನಕ್ಷೆಯಲ್ಲಿ ಕಾಣುತ್ತವೆ. ಹೊಸ ಉಪಕರಣ ಇಡುವುದು, ಕೇಬಲ್ ಎಳೆಯುವುದು ಇಲ್ಲಿಯೇ.',
      ),
    },
  },
  {
    key: 'menu.view3d',
    title: '3D View',
    text: {
      en: english(
        '3D View shows the same network in three dimensions: poles, boxes, cables and houses. Drag to move around, and tap an item to see its details.',
      ),
      te: draft(
        '3D View అదే నెట్‌వర్క్‌ను మూడు కోణాల్లో చూపిస్తుంది: poles, boxes, cables, ఇళ్లు. లాగి చుట్టూ చూడండి, వివరాల కోసం దేన్నైనా నొక్కండి.',
      ),
      kn: draft(
        '3D View ಅದೇ ನೆಟ್‌ವರ್ಕ್ ಅನ್ನು ಮೂರು ಆಯಾಮದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ: ಕಂಬಗಳು, ಬಾಕ್ಸ್‌ಗಳು, ಕೇಬಲ್‌ಗಳು, ಮನೆಗಳು. ಎಳೆದು ಸುತ್ತ ನೋಡಿ, ವಿವರಕ್ಕಾಗಿ ಯಾವುದನ್ನಾದರೂ ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'menu.twin',
    title: 'Digital Twin',
    text: {
      en: english(
        'Digital Twin is a realistic 3D model of the whole network, from the OLT rack to every house. It shows which splitter outputs are used and which are free.',
      ),
      te: draft(
        'Digital Twin మొత్తం నెట్‌వర్క్ యొక్క నిజంలా కనిపించే 3D నమూనా, OLT rack నుండి ప్రతి ఇంటి వరకు. splitterలో ఏ అవుట్‌పుట్లు వాడుతున్నారో, ఏవి ఖాళీగా ఉన్నాయో చూపిస్తుంది.',
      ),
      kn: draft(
        'Digital Twin ಇಡೀ ನೆಟ್‌ವರ್ಕ್‌ನ ನಿಜದಂತೆ ಕಾಣುವ 3D ಮಾದರಿ, ಒಎಲ್‌ಟಿ ರ್ಯಾಕ್‌ನಿಂದ ಪ್ರತಿ ಮನೆಯವರೆಗೆ. ಸ್ಪ್ಲಿಟರ್‌ನ ಯಾವ ಔಟ್‌ಪುಟ್ ಬಳಕೆಯಲ್ಲಿದೆ, ಯಾವುದು ಖಾಲಿ ಎಂದು ತೋರಿಸುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'menu.equipment',
    title: 'Equipment',
    text: {
      en: english(
        'Equipment is the list of every machine, box and pole. Type in the search box to find one, and tap the pin button to see it on the map.',
      ),
      te: draft(
        'Equipment అనేది ప్రతి మెషిన్, box, pole జాబితా. వెతకడానికి సెర్చ్ పెట్టెలో టైప్ చేయండి, మ్యాప్‌లో చూడడానికి పిన్ బటన్ నొక్కండి.',
      ),
      kn: draft(
        'Equipment ಎಂದರೆ ಪ್ರತಿ ಯಂತ್ರ, ಬಾಕ್ಸ್, ಕಂಬದ ಪಟ್ಟಿ. ಹುಡುಕಲು ಸರ್ಚ್ ಪೆಟ್ಟಿಗೆಯಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ, ನಕ್ಷೆಯಲ್ಲಿ ನೋಡಲು ಪಿನ್ ಬಟನ್ ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'menu.cables',
    title: 'Cables',
    text: {
      en: english(
        'Cables lists every fiber cable: how many fibers it has, how many are used and free, its length and its colour code.',
      ),
      te: draft(
        'Cables ప్రతి fiber cable జాబితా: అందులో ఎన్ని fibers ఉన్నాయి, ఎన్ని వాడుతున్నారు, ఎన్ని ఖాళీ, పొడవు, రంగు కోడ్.',
      ),
      kn: draft(
        'Cables ಪ್ರತಿ ಫೈಬರ್ ಕೇಬಲ್‌ನ ಪಟ್ಟಿ: ಎಷ್ಟು ಫೈಬರ್‌ಗಳಿವೆ, ಎಷ್ಟು ಬಳಕೆಯಲ್ಲಿವೆ, ಎಷ್ಟು ಖಾಲಿ, ಉದ್ದ, ಬಣ್ಣದ ಕೋಡ್.',
      ),
    },
  },
  {
    key: 'menu.customers',
    title: 'Customers',
    text: {
      en: english(
        'Customers lists every subscriber with the plan, the box and port, the house device serial and the light level. You can add a new customer here too.',
      ),
      te: draft(
        'Customers ప్రతి కస్టమర్ జాబితా: ప్లాన్, box, port, ఇంటి పరికరం సీరియల్, లైట్ లెవెల్. కొత్త కస్టమర్‌ను ఇక్కడ కూడా జోడించవచ్చు.',
      ),
      kn: draft(
        'Customers ಪ್ರತಿ ಗ್ರಾಹಕರ ಪಟ್ಟಿ: ಪ್ಲಾನ್, ಬಾಕ್ಸ್, ಪೋರ್ಟ್, ಮನೆಯ ಉಪಕರಣದ ಸೀರಿಯಲ್, ಲೈಟ್ ಲೆವೆಲ್. ಹೊಸ ಗ್ರಾಹಕರನ್ನು ಇಲ್ಲಿಯೂ ಸೇರಿಸಬಹುದು.',
      ),
    },
  },
  {
    key: 'menu.capture',
    title: 'Field capture',
    text: {
      en: english(
        'Field capture is for the phone in the street. Big picture buttons add a pole, a box, a house wire or a light reading, with a photo and GPS.',
      ),
      te: draft(
        'Field capture వీధిలో ఫోన్ కోసం. పెద్ద బొమ్మ బటన్లతో pole, box, ఇంటి wire లేదా లైట్ రీడింగ్‌ను ఫోటో, జీపీఎస్‌తో జోడించవచ్చు.',
      ),
      kn: draft(
        'Field capture ಬೀದಿಯಲ್ಲಿ ಫೋನ್‌ಗಾಗಿ. ದೊಡ್ಡ ಚಿತ್ರದ ಬಟನ್‌ಗಳಿಂದ ಕಂಬ, ಬಾಕ್ಸ್, ಮನೆ ವೈರ್ ಅಥವಾ ಲೈಟ್ ರೀಡಿಂಗ್ ಅನ್ನು ಫೋಟೋ ಮತ್ತು ಜಿಪಿಎಸ್ ಜೊತೆ ಸೇರಿಸಬಹುದು.',
      ),
    },
  },
  {
    key: 'menu.operations',
    title: 'Operations',
    text: {
      en: english(
        'Operations holds faults and work orders. Create a work order, give it to a technician, and follow it until it is finished.',
      ),
      te: draft(
        'Operationsలో ఫాల్ట్‌లు, వర్క్ ఆర్డర్లు ఉంటాయి. వర్క్ ఆర్డర్ తయారు చేసి, టెక్నీషియన్‌కు ఇచ్చి, అది పూర్తయ్యే వరకు చూడండి.',
      ),
      kn: draft(
        'Operations ನಲ್ಲಿ ದೋಷಗಳು ಮತ್ತು ವರ್ಕ್ ಆರ್ಡರ್‌ಗಳಿವೆ. ವರ್ಕ್ ಆರ್ಡರ್ ಮಾಡಿ, ತಂತ್ರಜ್ಞರಿಗೆ ಕೊಡಿ, ಅದು ಮುಗಿಯುವವರೆಗೆ ನೋಡಿ.',
      ),
    },
  },
  {
    key: 'menu.field',
    title: 'Field Work',
    text: {
      en: english(
        "Field Work shows the technicians' jobs. Navigate shows the way to the place, and Report fault tells the office about a problem.",
      ),
      te: draft(
        'Field Work టెక్నీషియన్ల పనులను చూపిస్తుంది. Navigate ఆ చోటికి దారి చూపిస్తుంది, Report fault సమస్యను ఆఫీసుకు తెలియజేస్తుంది.',
      ),
      kn: draft(
        'Field Work ತಂತ್ರಜ್ಞರ ಕೆಲಸಗಳನ್ನು ತೋರಿಸುತ್ತದೆ. Navigate ಆ ಜಾಗಕ್ಕೆ ದಾರಿ ತೋರಿಸುತ್ತದೆ, Report fault ಸಮಸ್ಯೆಯನ್ನು ಕಚೇರಿಗೆ ತಿಳಿಸುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'menu.agent',
    title: 'Agent Tracking',
    text: {
      en: english(
        "Agent Tracking records a field agent's route for the day, from Start Duty to End Duty, and makes a daily report.",
      ),
      te: draft(
        'Agent Tracking ఫీల్డ్ ఏజెంట్ రోజు దారిని Start Duty నుండి End Duty వరకు నమోదు చేసి, రోజువారీ నివేదిక ఇస్తుంది.',
      ),
      kn: draft(
        'Agent Tracking ಫೀಲ್ಡ್ ಏಜೆಂಟ್‌ನ ದಿನದ ದಾರಿಯನ್ನು Start Duty ಯಿಂದ End Duty ವರೆಗೆ ದಾಖಲಿಸಿ, ದಿನದ ವರದಿ ಮಾಡುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'menu.onuFleet',
    title: 'ONU Fleet',
    text: {
      en: english(
        'ONU Fleet lists every house device: its serial number, its customer, its light level and its place on the map.',
      ),
      te: draft('ONU Fleet ప్రతి ఇంటి పరికరం జాబితా: సీరియల్ నంబర్, కస్టమర్, లైట్ లెవెల్, మ్యాప్‌లో దాని స్థలం.'),
      kn: draft('ONU Fleet ಪ್ರತಿ ಮನೆಯ ಉಪಕರಣದ ಪಟ್ಟಿ: ಸೀರಿಯಲ್ ಸಂಖ್ಯೆ, ಗ್ರಾಹಕ, ಲೈಟ್ ಲೆವೆಲ್, ನಕ್ಷೆಯಲ್ಲಿ ಅದರ ಸ್ಥಳ.'),
    },
  },
  {
    key: 'menu.trace',
    title: 'Route Trace',
    text: {
      en: english(
        'Route Trace follows the light from the OLT to a customer, box by box, and shows the loss on the way. Search for a customer to start.',
      ),
      te: draft(
        'Route Trace OLT నుండి కస్టమర్ వరకు box తర్వాత box వెలుతురు దారిని చూపిస్తుంది, దారిలో నష్టం కూడా. మొదలుపెట్టడానికి కస్టమర్‌ను వెతకండి.',
      ),
      kn: draft(
        'Route Trace ಒಎಲ್‌ಟಿಯಿಂದ ಗ್ರಾಹಕರವರೆಗೆ ಬಾಕ್ಸ್ ನಂತರ ಬಾಕ್ಸ್ ಬೆಳಕಿನ ದಾರಿಯನ್ನು ತೋರಿಸುತ್ತದೆ, ದಾರಿಯ ನಷ್ಟವೂ. ಶುರು ಮಾಡಲು ಗ್ರಾಹಕರನ್ನು ಹುಡುಕಿ.',
      ),
    },
  },
  {
    key: 'menu.boxes',
    title: 'Terminal Boxes',
    text: {
      en: english(
        'Terminal Boxes shows each street box with its splitter outputs: which are used, and which are free for a new connection.',
      ),
      te: draft(
        'Terminal Boxes ప్రతి వీధి box splitter అవుట్‌పుట్లను చూపిస్తుంది: ఏవి వాడుతున్నారు, కొత్త కనెక్షన్‌కు ఏవి ఖాళీ.',
      ),
      kn: draft(
        'Terminal Boxes ಪ್ರತಿ ಬೀದಿ ಬಾಕ್ಸ್‌ನ ಸ್ಪ್ಲಿಟರ್ ಔಟ್‌ಪುಟ್‌ಗಳನ್ನು ತೋರಿಸುತ್ತದೆ: ಯಾವುದು ಬಳಕೆಯಲ್ಲಿದೆ, ಹೊಸ ಸಂಪರ್ಕಕ್ಕೆ ಯಾವುದು ಖಾಲಿ.',
      ),
    },
  },
  {
    key: 'menu.live',
    title: 'Live status',
    text: {
      en: english(
        'Live status shows which customers are online or offline, when the OLT sends its readings. With nothing sent, it says No live connection.',
      ),
      te: draft(
        'OLT రీడింగ్‌లు పంపినప్పుడు ఏ కస్టమర్లు ఆన్‌లైన్, ఏవి ఆఫ్‌లైన్ అని Live status చూపిస్తుంది. ఏమీ రాకపోతే No live connection అని చెబుతుంది.',
      ),
      kn: draft(
        'OLT ರೀಡಿಂಗ್ ಕಳುಹಿಸಿದಾಗ ಯಾವ ಗ್ರಾಹಕರು ಆನ್‌ಲೈನ್, ಯಾರು ಆಫ್‌ಲೈನ್ ಎಂದು Live status ತೋರಿಸುತ್ತದೆ. ಏನೂ ಬರದಿದ್ದರೆ No live connection ಎನ್ನುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'menu.knowledge',
    title: 'Equipment Guide',
    text: {
      en: english(
        'Equipment Guide explains every piece of equipment in simple words, with pictures: what it is, what it does and where it is fitted.',
      ),
      te: draft(
        'Equipment Guide ప్రతి పరికరాన్ని బొమ్మలతో సులభమైన మాటల్లో వివరిస్తుంది: అది ఏమిటి, ఏం చేస్తుంది, ఎక్కడ పెడతారు.',
      ),
      kn: draft(
        'Equipment Guide ಪ್ರತಿ ಉಪಕರಣವನ್ನು ಚಿತ್ರಗಳೊಂದಿಗೆ ಸರಳ ಪದಗಳಲ್ಲಿ ವಿವರಿಸುತ್ತದೆ: ಅದು ಏನು, ಏನು ಮಾಡುತ್ತದೆ, ಎಲ್ಲಿ ಹಾಕುತ್ತಾರೆ.',
      ),
    },
  },
  {
    key: 'menu.admin',
    title: 'Administration',
    text: {
      en: english('Administration is for the office: users and passwords, fiber colour codes, settings and backup.'),
      te: draft('Administration ఆఫీసు కోసం: యూజర్లు, పాస్‌వర్డ్‌లు, fiber రంగు కోడ్‌లు, సెట్టింగ్‌లు, బ్యాకప్.'),
      kn: draft('Administration ಕಚೇರಿಗಾಗಿ: ಬಳಕೆದಾರರು, ಪಾಸ್‌ವರ್ಡ್‌ಗಳು, ಫೈಬರ್ ಬಣ್ಣದ ಕೋಡ್‌ಗಳು, ಸೆಟ್ಟಿಂಗ್‌ಗಳು, ಬ್ಯಾಕಪ್.'),
    },
  },
  {
    key: 'menu.done',
    title: 'All pages',
    text: {
      en: english(
        'That is every page. To map from the OLT to a house, tap Guide and choose Map the network step by step.',
      ),
      te: draft(
        'ఇవే అన్ని పేజీలు. OLT నుండి ఇంటి వరకు మ్యాప్ చేయడానికి Guide నొక్కి, Map the network step by step ఎంచుకోండి.',
      ),
      kn: draft(
        'ಇವೇ ಎಲ್ಲಾ ಪುಟಗಳು. ಒಎಲ್‌ಟಿಯಿಂದ ಮನೆಯವರೆಗೆ ನಕ್ಷೆ ಮಾಡಲು Guide ಒತ್ತಿ, Map the network step by step ಆಯ್ಕೆ ಮಾಡಿ.',
      ),
    },
  },
  {
    key: 'map.intro',
    title: 'Map the network',
    terms: ['OLT', 'FDT', 'FAT', 'ONT'],
    text: {
      en: english(
        'Now we will map a real network together: the OLT, the feeder cable, the FDT with its splitter, the distribution cable, the FAT box and the customer. You do each step, and I will wait for you. If you miss something, tap Back.',
      ),
      te: draft(
        'ఇప్పుడు మనం కలిసి అసలు నెట్‌వర్క్‌ను మ్యాప్ చేద్దాం: OLT, feeder cable, splitterతో FDT, distribution cable, FAT box, కస్టమర్. ప్రతి దశ మీరు చేయండి, నేను ఎదురుచూస్తాను. ఏదైనా తప్పితే Back నొక్కండి.',
      ),
      kn: draft(
        'ಈಗ ನಾವು ಜೊತೆಯಾಗಿ ನಿಜವಾದ ನೆಟ್‌ವರ್ಕ್ ನಕ್ಷೆ ಮಾಡೋಣ: ಒಎಲ್‌ಟಿ, ಫೀಡರ್ ಕೇಬಲ್, ಸ್ಪ್ಲಿಟರ್ ಇರುವ ಎಫ್‌ಡಿಟಿ, ಡಿಸ್ಟ್ರಿಬ್ಯೂಷನ್ ಕೇಬಲ್, ಎಫ್‌ಎಟಿ ಬಾಕ್ಸ್, ಗ್ರಾಹಕ. ಪ್ರತಿ ಹಂತ ನೀವು ಮಾಡಿ, ನಾನು ಕಾಯುತ್ತೇನೆ. ಏನಾದರೂ ತಪ್ಪಿದರೆ Back ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.oltList',
    title: 'OLT: open the list',
    text: {
      en: english('First, the main machine, the OLT. Tap the Equipment button.'),
      te: draft('మొదట, మెయిన్ మెషిన్ OLT. Equipment బటన్ నొక్కండి.'),
      kn: draft('ಮೊದಲು, ಮುಖ್ಯ ಯಂತ್ರ ಒಎಲ್‌ಟಿ. Equipment ಬಟನ್ ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.oltPick',
    title: 'OLT: choose it',
    terms: ['Optical Line Terminal (OLT)'],
    text: {
      en: english('The list is open. Tap Optical Line Terminal, OLT.'),
      te: draft('జాబితా తెరిచి ఉంది. Optical Line Terminal (OLT) నొక్కండి.'),
      kn: draft('ಪಟ್ಟಿ ತೆರೆದಿದೆ. Optical Line Terminal (OLT) ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.oltPlace',
    title: 'OLT: place it',
    text: {
      en: english(
        'Now tap the map at your main office. The OLT is placed there. If it asks Is this the same one, choose a new one.',
      ),
      te: draft(
        'ఇప్పుడు మీ మెయిన్ ఆఫీసు ఉన్న చోట మ్యాప్‌పై నొక్కండి. OLT అక్కడ పెట్టబడుతుంది. Is this the same one అని అడిగితే, కొత్తది ఎంచుకోండి.',
      ),
      kn: draft(
        'ಈಗ ನಿಮ್ಮ ಮುಖ್ಯ ಕಚೇರಿ ಇರುವ ಜಾಗದಲ್ಲಿ ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತಿ. ಒಎಲ್‌ಟಿ ಅಲ್ಲಿ ಇಡಲಾಗುತ್ತದೆ. Is this the same one ಎಂದು ಕೇಳಿದರೆ, ಹೊಸದನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.',
      ),
    },
  },
  {
    key: 'map.oltSetup',
    title: 'OLT: set up its lines',
    terms: ['PON Ports', 'Save Configuration'],
    text: {
      en: english(
        'The setup window is open. Open PON Ports and choose how many lines the OLT has. Then tap Save Configuration.',
      ),
      te: draft(
        'సెటప్ విండో తెరిచి ఉంది. PON Ports తెరిచి, OLTకి ఎన్ని లైన్లు ఉన్నాయో ఎంచుకోండి. తర్వాత Save Configuration నొక్కండి.',
      ),
      kn: draft(
        'ಸೆಟಪ್ ಕಿಟಕಿ ತೆರೆದಿದೆ. PON Ports ತೆರೆದು, ಒಎಲ್‌ಟಿಗೆ ಎಷ್ಟು ಲೈನ್‌ಗಳಿವೆ ಎಂದು ಆಯ್ಕೆ ಮಾಡಿ. ನಂತರ Save Configuration ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.fdtList',
    title: 'FDT: open the list',
    text: {
      en: english('Next, the street cabinet that holds the first splitter, the FDT. Tap Equipment again.'),
      te: draft('తర్వాత, మొదటి splitter ఉండే వీధి cabinet, FDT. మళ్లీ Equipment నొక్కండి.'),
      kn: draft('ಮುಂದೆ, ಮೊದಲ ಸ್ಪ್ಲಿಟರ್ ಇರುವ ಬೀದಿ ಕ್ಯಾಬಿನೆಟ್, ಎಫ್‌ಡಿಟಿ. ಮತ್ತೆ Equipment ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fdtPick',
    title: 'FDT: choose it',
    terms: ['Fiber Distribution Terminal (FDT)'],
    text: {
      en: english('Tap Fiber Distribution Terminal, FDT.'),
      te: draft('Fiber Distribution Terminal (FDT) నొక్కండి.'),
      kn: draft('Fiber Distribution Terminal (FDT) ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fdtPlace',
    title: 'FDT: place it',
    text: {
      en: english('Tap the map where the cabinet stands, along the road from the office.'),
      te: draft('ఆఫీసు నుండి రోడ్డు వెంట, cabinet ఉన్న చోట మ్యాప్‌పై నొక్కండి.'),
      kn: draft('ಕಚೇರಿಯಿಂದ ರಸ್ತೆಯುದ್ದಕ್ಕೂ, ಕ್ಯಾಬಿನೆಟ್ ಇರುವ ಜಾಗದಲ್ಲಿ ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.feederSelect',
    title: 'Feeder cable: tap the OLT',
    text: {
      en: english('Now the main road cable, the feeder cable, from the OLT to the FDT. Tap your OLT on the map.'),
      te: draft(
        'ఇప్పుడు మెయిన్ రోడ్ cable, అంటే feeder cable, OLT నుండి FDT వరకు. మ్యాప్‌లో మీ OLTని నొక్కండి.',
      ),
      kn: draft(
        'ಈಗ ಮುಖ್ಯ ರಸ್ತೆ ಕೇಬಲ್, ಅಂದರೆ ಫೀಡರ್ ಕೇಬಲ್, ಒಎಲ್‌ಟಿಯಿಂದ ಎಫ್‌ಡಿಟಿಗೆ. ನಕ್ಷೆಯಲ್ಲಿ ನಿಮ್ಮ ಒಎಲ್‌ಟಿಯನ್ನು ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.feederStart',
    title: 'Feeder cable: start drawing',
    terms: ['Draw feeder cable'],
    text: {
      en: english('In the small window, tap Draw feeder cable.'),
      te: draft('చిన్న విండోలో Draw feeder cable నొక్కండి.'),
      kn: draft('ಚಿಕ್ಕ ಕಿಟಕಿಯಲ್ಲಿ Draw feeder cable ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.feederRoute',
    title: 'Feeder cable: draw the road',
    terms: ['Finish'],
    text: {
      en: english(
        'Tap the map along the road, once at every corner. At the end, tap right on the FDT picture, so the cable joins it. Then tap Finish.',
      ),
      te: draft(
        'రోడ్డు వెంట, ప్రతి మలుపులో ఒకసారి మ్యాప్‌పై నొక్కండి. చివరలో FDT బొమ్మ మీదే నొక్కండి, అప్పుడు cable దానికి కలుస్తుంది. తర్వాత Finish నొక్కండి.',
      ),
      kn: draft(
        'ರಸ್ತೆಯುದ್ದಕ್ಕೂ, ಪ್ರತಿ ತಿರುವಿನಲ್ಲಿ ಒಮ್ಮೆ ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತಿ. ಕೊನೆಯಲ್ಲಿ ಎಫ್‌ಡಿಟಿ ಚಿತ್ರದ ಮೇಲೆಯೇ ಒತ್ತಿ, ಆಗ ಕೇಬಲ್ ಅದಕ್ಕೆ ಸೇರುತ್ತದೆ. ನಂತರ Finish ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.feederKind',
    title: 'Feeder cable: kind and fibers',
    terms: ['Main Feeder Fiber', 'Next'],
    text: {
      en: english(
        'The Save Cable window has a few pages. On the first pages, Kind and Fibres, check that it says Main Feeder Fiber, and how many fibers the cable has, for example 48. Tap Next on each page.',
      ),
      te: draft(
        'Save Cable విండోలో కొన్ని పేజీలు ఉన్నాయి. మొదటి పేజీలు Kind, Fibresలో Main Feeder Fiber అని ఉందో, cableలో ఎన్ని fibers ఉన్నాయో, ఉదాహరణకు 48, చూడండి. ప్రతి పేజీలో Next నొక్కండి.',
      ),
      kn: draft(
        'Save Cable ಕಿಟಕಿಯಲ್ಲಿ ಕೆಲವು ಪುಟಗಳಿವೆ. ಮೊದಲ ಪುಟಗಳು Kind, Fibres ನಲ್ಲಿ Main Feeder Fiber ಎಂದು ಇದೆಯೇ, ಕೇಬಲ್‌ನಲ್ಲಿ ಎಷ್ಟು ಫೈಬರ್‌ಗಳಿವೆ, ಉದಾಹರಣೆಗೆ 48, ನೋಡಿ. ಪ್ರತಿ ಪುಟದಲ್ಲಿ Next ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.feederEnds',
    title: 'Feeder cable: its two ends',
    terms: ['Yes, connect', 'OLT PON port'],
    text: {
      en: english(
        'This is the Ends page. Read Your line touches. If it names your OLT and your FDT, tap Yes, connect. Then choose the OLT PON port, that is the line number, and tap Next.',
      ),
      te: draft(
        'ఇది Ends పేజీ. Your line touches చదవండి. అందులో మీ OLT, FDT పేర్లు ఉంటే Yes, connect నొక్కండి. తర్వాత OLT PON port, అంటే లైన్ నంబర్ ఎంచుకుని Next నొక్కండి.',
      ),
      kn: draft(
        'ಇದು Ends ಪುಟ. Your line touches ಓದಿ. ಅದರಲ್ಲಿ ನಿಮ್ಮ ಒಎಲ್‌ಟಿ, ಎಫ್‌ಡಿಟಿ ಹೆಸರುಗಳಿದ್ದರೆ Yes, connect ಒತ್ತಿ. ನಂತರ OLT PON port, ಅಂದರೆ ಲೈನ್ ಸಂಖ್ಯೆ ಆಯ್ಕೆ ಮಾಡಿ Next ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.feederSave',
    title: 'Feeder cable: save it',
    terms: ['Next', 'Save Cable'],
    text: {
      en: english('Tap Next through Route, Poles and Slack. On the last page, Check, tap Save Cable.'),
      te: draft('Route, Poles, Slack పేజీల్లో Next నొక్కుతూ వెళ్లండి. చివరి పేజీ Checkలో Save Cable నొక్కండి.'),
      kn: draft('Route, Poles, Slack ಪುಟಗಳಲ್ಲಿ Next ಒತ್ತುತ್ತಾ ಹೋಗಿ. ಕೊನೆಯ ಪುಟ Check ನಲ್ಲಿ Save Cable ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.feederStop',
    title: 'Feeder cable: stop drawing',
    terms: ['Select'],
    text: {
      en: english('The cable is saved. Now tap the arrow button, Select, on the toolbar, to stop drawing.'),
      te: draft('cable సేవ్ అయింది. గీయడం ఆపడానికి టూల్‌బార్‌లోని బాణం బటన్ Select నొక్కండి.'),
      kn: draft('ಕೇಬಲ್ ಉಳಿಯಿತು. ಎಳೆಯುವುದನ್ನು ನಿಲ್ಲಿಸಲು ಟೂಲ್‌ಬಾರ್‌ನ ಬಾಣದ ಬಟನ್ Select ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fdtSplitterOpen',
    title: 'FDT splitter: tap the FDT',
    text: {
      en: english('Now put a splitter in the FDT. Tap the FDT on the map.'),
      te: draft('ఇప్పుడు FDTలో splitter పెట్టండి. మ్యాప్‌లో FDTని నొక్కండి.'),
      kn: draft('ಈಗ ಎಫ್‌ಡಿಟಿಯಲ್ಲಿ ಸ್ಪ್ಲಿಟರ್ ಇಡಿ. ನಕ್ಷೆಯಲ್ಲಿ ಎಫ್‌ಡಿಟಿಯನ್ನು ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fdtSplitterAdd',
    title: 'FDT splitter: add it',
    terms: ['Connectivity', '1:8', 'Add splitter'],
    text: {
      en: english(
        'On the right, open Connectivity. Under Add a splitter, choose one to eight in Equal split, then tap Add splitter.',
      ),
      te: draft(
        'కుడివైపు Connectivity తెరవండి. Add a splitter కింద Equal splitలో 1:8 ఎంచుకుని, Add splitter నొక్కండి.',
      ),
      kn: draft(
        'ಬಲಭಾಗದಲ್ಲಿ Connectivity ತೆರೆಯಿರಿ. Add a splitter ಕೆಳಗೆ Equal split ನಲ್ಲಿ 1:8 ಆಯ್ಕೆ ಮಾಡಿ, Add splitter ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.fatList',
    title: 'FAT: open the list',
    text: {
      en: english('Next, the street box near the houses, the FAT. Tap Equipment.'),
      te: draft('తర్వాత, ఇళ్ల దగ్గర ఉండే వీధి box, FAT. Equipment నొక్కండి.'),
      kn: draft('ಮುಂದೆ, ಮನೆಗಳ ಹತ್ತಿರದ ಬೀದಿ ಬಾಕ್ಸ್, ಎಫ್‌ಎಟಿ. Equipment ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fatPick',
    title: 'FAT: choose it',
    terms: ['FAT Terminal Box'],
    text: {
      en: english('Tap FAT Terminal Box.'),
      te: draft('FAT Terminal Box నొక్కండి.'),
      kn: draft('FAT Terminal Box ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.fatPlace',
    title: 'FAT: place it',
    text: {
      en: english('Tap the map at the pole where the box is fitted. Mapping never needs climbing a pole.'),
      te: draft('box అమర్చిన pole దగ్గర మ్యాప్‌పై నొక్కండి. మ్యాపింగ్ కోసం pole ఎక్కాల్సిన అవసరం ఎప్పుడూ లేదు.'),
      kn: draft('ಬಾಕ್ಸ್ ಅಳವಡಿಸಿರುವ ಕಂಬದ ಬಳಿ ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತಿ. ನಕ್ಷೆ ಮಾಡಲು ಕಂಬ ಹತ್ತುವ ಅಗತ್ಯ ಎಂದಿಗೂ ಇಲ್ಲ.'),
    },
  },
  {
    key: 'map.distSelect',
    title: 'Distribution cable: tap the FDT',
    text: {
      en: english('Now the street cable, the distribution cable, from the FDT to the FAT. Tap the FDT on the map.'),
      te: draft(
        'ఇప్పుడు వీధి cable, అంటే distribution cable, FDT నుండి FAT వరకు. మ్యాప్‌లో FDTని నొక్కండి.',
      ),
      kn: draft('ಈಗ ಬೀದಿ ಕೇಬಲ್, ಅಂದರೆ ಡಿಸ್ಟ್ರಿಬ್ಯೂಷನ್ ಕೇಬಲ್, ಎಫ್‌ಡಿಟಿಯಿಂದ ಎಫ್‌ಎಟಿಗೆ. ನಕ್ಷೆಯಲ್ಲಿ ಎಫ್‌ಡಿಟಿಯನ್ನು ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.distStart',
    title: 'Distribution cable: start drawing',
    terms: ['Details', 'Tools', 'Start cable here'],
    text: {
      en: english('On the right, open Details. Then, under Tools, tap Start cable here.'),
      te: draft('కుడివైపు Details తెరవండి. తర్వాత Tools కింద Start cable here నొక్కండి.'),
      kn: draft('ಬಲಭಾಗದಲ್ಲಿ Details ತೆರೆಯಿರಿ. ನಂತರ Tools ಕೆಳಗೆ Start cable here ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.distRoute',
    title: 'Distribution cable: draw the street',
    terms: ['Finish'],
    text: {
      en: english('Tap along the street at every corner, and end right on the FAT picture. Then tap Finish.'),
      te: draft('వీధి వెంట ప్రతి మలుపులో నొక్కి, చివరలో FAT బొమ్మ మీదే నొక్కండి. తర్వాత Finish నొక్కండి.'),
      kn: draft('ಬೀದಿಯುದ್ದಕ್ಕೂ ಪ್ರತಿ ತಿರುವಿನಲ್ಲಿ ಒತ್ತಿ, ಕೊನೆಯಲ್ಲಿ ಎಫ್‌ಎಟಿ ಚಿತ್ರದ ಮೇಲೆಯೇ ಒತ್ತಿ. ನಂತರ Finish ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.distKind',
    title: 'Distribution cable: kind and fibers',
    terms: ['Cable type', 'Distribution Fiber', 'Next'],
    text: {
      en: english(
        'Save Cable opens again. Under Cable type, choose Distribution Fiber, and check how many fibers it has, for example 12 or 6. Tap Next.',
      ),
      te: draft(
        'Save Cable మళ్లీ తెరుచుకుంటుంది. Cable type కింద Distribution Fiber ఎంచుకోండి, ఎన్ని fibers ఉన్నాయో, ఉదాహరణకు 12 లేదా 6, చూడండి. Next నొక్కండి.',
      ),
      kn: draft(
        'Save Cable ಮತ್ತೆ ತೆರೆಯುತ್ತದೆ. Cable type ಕೆಳಗೆ Distribution Fiber ಆಯ್ಕೆ ಮಾಡಿ, ಎಷ್ಟು ಫೈಬರ್‌ಗಳಿವೆ, ಉದಾಹರಣೆಗೆ 12 ಅಥವಾ 6, ನೋಡಿ. Next ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.distEnds',
    title: 'Distribution cable: its two ends',
    terms: ['Yes, connect'],
    text: {
      en: english('On Ends, if Your line touches names your FDT and your FAT, tap Yes, connect. Then tap Next.'),
      te: draft(
        'Endsలో Your line touches మీ FDT, FAT పేర్లు చూపిస్తే Yes, connect నొక్కండి. తర్వాత Next నొక్కండి.',
      ),
      kn: draft(
        'Ends ನಲ್ಲಿ Your line touches ನಿಮ್ಮ ಎಫ್‌ಡಿಟಿ, ಎಫ್‌ಎಟಿ ಹೆಸರು ತೋರಿಸಿದರೆ Yes, connect ಒತ್ತಿ. ನಂತರ Next ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.distSave',
    title: 'Distribution cable: save it',
    terms: ['Next', 'Save Cable'],
    text: {
      en: english('Tap Next through the other pages. On the last page, Check, tap Save Cable.'),
      te: draft('మిగతా పేజీల్లో Next నొక్కుతూ వెళ్లండి. చివరి పేజీ Checkలో Save Cable నొక్కండి.'),
      kn: draft('ಉಳಿದ ಪುಟಗಳಲ್ಲಿ Next ಒತ್ತುತ್ತಾ ಹೋಗಿ. ಕೊನೆಯ ಪುಟ Check ನಲ್ಲಿ Save Cable ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.distStop',
    title: 'Distribution cable: stop drawing',
    terms: ['Select'],
    text: {
      en: english('The cable is saved. Now tap the arrow button, Select, on the toolbar, to stop drawing.'),
      te: draft('cable సేవ్ అయింది. గీయడం ఆపడానికి టూల్‌బార్‌లోని బాణం బటన్ Select నొక్కండి.'),
      kn: draft('ಕೇಬಲ್ ಉಳಿಯಿತು. ಎಳೆಯುವುದನ್ನು ನಿಲ್ಲಿಸಲು ಟೂಲ್‌ಬಾರ್‌ನ ಬಾಣದ ಬಟನ್ Select ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.custOpen',
    title: 'Customer: open the form',
    text: {
      en: english("Last, the customer's house. Tap Add customer."),
      te: draft('చివరగా, కస్టమర్ ఇల్లు. Add customer నొక్కండి.'),
      kn: draft('ಕೊನೆಯದಾಗಿ, ಗ್ರಾಹಕರ ಮನೆ. Add customer ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.custBox',
    title: 'Customer: choose the box',
    terms: ['Access Terminal (FAT)'],
    text: {
      en: english("Type the customer's name and phone. Under Access Terminal, FAT, choose your new box."),
      te: draft('కస్టమర్ పేరు, ఫోన్ టైప్ చేయండి. Access Terminal (FAT) కింద మీ కొత్త box ఎంచుకోండి.'),
      kn: draft('ಗ್ರಾಹಕರ ಹೆಸರು, ಫೋನ್ ಟೈಪ್ ಮಾಡಿ. Access Terminal (FAT) ಕೆಳಗೆ ನಿಮ್ಮ ಹೊಸ ಬಾಕ್ಸ್ ಆಯ್ಕೆ ಮಾಡಿ.'),
    },
  },
  {
    key: 'map.custSplitter',
    title: 'Customer: the box splitter',
    terms: ['1:8', 'Add splitter', 'Splitter Module'],
    text: {
      en: english(
        'If it says the box has no splitter yet, tap one to eight, then tap Add splitter. If the box has a splitter, choose it under Splitter Module.',
      ),
      te: draft(
        'boxలో ఇంకా splitter లేదని చెబితే, 1:8 నొక్కి, తర్వాత Add splitter నొక్కండి. boxలో splitter ఉంటే, Splitter Module కింద దాన్ని ఎంచుకోండి.',
      ),
      kn: draft(
        'ಬಾಕ್ಸ್‌ನಲ್ಲಿ ಇನ್ನೂ ಸ್ಪ್ಲಿಟರ್ ಇಲ್ಲ ಎಂದರೆ, 1:8 ಒತ್ತಿ, ನಂತರ Add splitter ಒತ್ತಿ. ಬಾಕ್ಸ್‌ನಲ್ಲಿ ಸ್ಪ್ಲಿಟರ್ ಇದ್ದರೆ, Splitter Module ಕೆಳಗೆ ಅದನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.',
      ),
    },
  },
  {
    key: 'map.custPort',
    title: 'Customer: the box output',
    terms: ['Select Available Output Port', 'Fiber 1'],
    text: {
      en: english(
        'Now tap a free output port of the splitter, a number that is not grey. Then, under Fiber in the new drop, tap Fiber 1.',
      ),
      te: draft(
        'ఇప్పుడు splitterలో ఖాళీగా ఉన్న అవుట్‌పుట్ port, అంటే బూడిద రంగులో లేని నంబర్ నొక్కండి. తర్వాత Fiber in the new drop కింద Fiber 1 నొక్కండి.',
      ),
      kn: draft(
        'ಈಗ ಸ್ಪ್ಲಿಟರ್‌ನ ಖಾಲಿ ಔಟ್‌ಪುಟ್ ಪೋರ್ಟ್, ಅಂದರೆ ಬೂದು ಬಣ್ಣದಲ್ಲಿ ಇಲ್ಲದ ಸಂಖ್ಯೆ ಒತ್ತಿ. ನಂತರ Fiber in the new drop ಕೆಳಗೆ Fiber 1 ಒತ್ತಿ.',
      ),
    },
  },
  {
    key: 'map.custPlace',
    title: 'Customer: where the house is',
    terms: ['Use my GPS', 'Pick on map'],
    text: {
      en: english('Stand at the house and tap Use my GPS, or tap Pick on map and tap the house.'),
      te: draft('ఇంటి దగ్గర నిలబడి Use my GPS నొక్కండి, లేదా Pick on map నొక్కి ఇంటిని నొక్కండి.'),
      kn: draft('ಮನೆಯ ಬಳಿ ನಿಂತು Use my GPS ಒತ್ತಿ, ಅಥವಾ Pick on map ಒತ್ತಿ ಮನೆಯನ್ನು ಒತ್ತಿ.'),
    },
  },
  {
    key: 'map.custSave',
    title: 'Customer: save',
    terms: ['Activate Subscriber', 'Save anyway'],
    text: {
      en: english(
        'Type the serial number from the label on the house device. Then tap Activate Subscriber. The house wire is drawn from the box to the house by itself.',
      ),
      te: draft(
        'ఇంటి పరికరం లేబుల్‌పై ఉన్న సీరియల్ నంబర్ టైప్ చేయండి. తర్వాత Activate Subscriber నొక్కండి. box నుండి ఇంటికి wire దానంతట అదే గీయబడుతుంది.',
      ),
      kn: draft(
        'ಮನೆಯ ಉಪಕರಣದ ಲೇಬಲ್ ಮೇಲಿನ ಸೀರಿಯಲ್ ಸಂಖ್ಯೆ ಟೈಪ್ ಮಾಡಿ. ನಂತರ Activate Subscriber ಒತ್ತಿ. ಬಾಕ್ಸ್‌ನಿಂದ ಮನೆಗೆ ವೈರ್ ತಾನಾಗಿಯೇ ಎಳೆಯಲಾಗುತ್ತದೆ.',
      ),
    },
  },
  {
    key: 'map.check',
    title: 'Check the path',
    terms: ['Service Path', 'Not linked'],
    text: {
      en: english(
        "Now check. Tap the new customer's house on the map. On the right, read Service Path. It should show your OLT. Not linked means a part is missing.",
      ),
      te: draft(
        'ఇప్పుడు తనిఖీ. మ్యాప్‌లో కొత్త కస్టమర్ ఇంటిని నొక్కండి. కుడివైపు Service Path చదవండి. అందులో మీ OLT ఉండాలి. Not linked అంటే ఒక భాగం లేదు.',
      ),
      kn: draft(
        'ಈಗ ಪರಿಶೀಲನೆ. ನಕ್ಷೆಯಲ್ಲಿ ಹೊಸ ಗ್ರಾಹಕರ ಮನೆಯನ್ನು ಒತ್ತಿ. ಬಲಭಾಗದಲ್ಲಿ Service Path ಓದಿ. ಅದರಲ್ಲಿ ನಿಮ್ಮ ಒಎಲ್‌ಟಿ ಇರಬೇಕು. Not linked ಅಂದರೆ ಒಂದು ಭಾಗ ಇಲ್ಲ.',
      ),
    },
  },
  {
    key: 'map.done',
    title: 'Well done',
    text: {
      en: english(
        'Well done. You mapped the OLT, the feeder cable, the FDT and its splitter, the distribution cable, the FAT and the customer. This records the work on the map. It does not switch on internet on the real machine.',
      ),
      te: draft(
        'బాగా చేశారు. మీరు OLT, feeder cable, FDT, దాని splitter, distribution cable, FAT, కస్టమర్‌ను మ్యాప్ చేశారు. ఇది పనిని మ్యాప్‌లో నమోదు చేస్తుంది. అసలు మెషిన్‌పై ఇంటర్నెట్ ఆన్ చేయదు.',
      ),
      kn: draft(
        'ಚೆನ್ನಾಗಿ ಮಾಡಿದಿರಿ. ನೀವು ಒಎಲ್‌ಟಿ, ಫೀಡರ್ ಕೇಬಲ್, ಎಫ್‌ಡಿಟಿ ಮತ್ತು ಅದರ ಸ್ಪ್ಲಿಟರ್, ಡಿಸ್ಟ್ರಿಬ್ಯೂಷನ್ ಕೇಬಲ್, ಎಫ್‌ಎಟಿ ಮತ್ತು ಗ್ರಾಹಕರನ್ನು ನಕ್ಷೆ ಮಾಡಿದಿರಿ. ಇದು ಕೆಲಸವನ್ನು ನಕ್ಷೆಯಲ್ಲಿ ದಾಖಲಿಸುತ್ತದೆ. ನಿಜವಾದ ಯಂತ್ರದಲ್ಲಿ ಇಂಟರ್ನೆಟ್ ಆನ್ ಮಾಡುವುದಿಲ್ಲ.',
      ),
    },
  },
  {
    key: 'demo.intro',
    title: 'Watch the network being mapped',
    terms: ['ISP', 'OLT', 'ODF', 'FDT', 'FAT', 'ONT'],
    text: {
      en: english(
        "Watch. I will follow the whole network, from the ISP down to the customer's phone. I build the fibre part on your real map: the OLT, the ODF, the feeder cable on its poles, the FDT splitter, the distribution cable, the FAT and the customer. At the end I remove what I made.",
      ),
      te: draft(
        'చూడండి. ISP నుండి కస్టమర్ ఫోన్ వరకు మొత్తం నెట్‌వర్క్‌ను అనుసరిస్తాను. ఫైబర్ భాగాన్ని మీ అసలు మ్యాప్‌పై కడతాను: OLT, ODF, స్తంభాలపై feeder cable, FDT splitter, distribution cable, FAT, కస్టమర్. చివరలో నేను చేసినవి తీసేస్తాను.',
      ),
      kn: draft(
        'ನೋಡಿ. ISPಯಿಂದ ಗ್ರಾಹಕರ ಫೋನ್‌ವರೆಗೆ ಇಡೀ ನೆಟ್‌ವರ್ಕ್ ಅನ್ನು ಅನುಸರಿಸುತ್ತೇನೆ. ಫೈಬರ್ ಭಾಗವನ್ನು ನಿಮ್ಮ ನಿಜವಾದ ನಕ್ಷೆಯಲ್ಲಿ ಕಟ್ಟುತ್ತೇನೆ: OLT, ODF, ಕಂಬಗಳ ಮೇಲಿನ feeder cable, FDT splitter, distribution cable, FAT ಮತ್ತು ಗ್ರಾಹಕ. ಕೊನೆಯಲ್ಲಿ ನಾನು ಮಾಡಿದ್ದನ್ನು ತೆಗೆಯುತ್ತೇನೆ.',
      ),
    },
  },
  {
    key: 'demo.custSave',
    title: 'Customer: save (not in the demo)',
    terms: ['Activate Subscriber'],
    text: {
      en: english(
        'Last, you type the serial number from the house device, and tap Activate Subscriber. In this demo I do not tap it, so no customer is saved. I close the form instead.',
      ),
      te: draft(
        'చివరగా, ఇంటి పరికరం సీరియల్ నంబర్ టైప్ చేసి Activate Subscriber నొక్కాలి. ఈ డెమోలో నేను దాన్ని నొక్కను, కాబట్టి కస్టమర్ సేవ్ కాదు. బదులుగా ఫారం మూసేస్తాను.',
      ),
      kn: draft(
        'ಕೊನೆಯದಾಗಿ, ಮನೆಯ ಉಪಕರಣದ ಸೀರಿಯಲ್ ಸಂಖ್ಯೆ ಟೈಪ್ ಮಾಡಿ Activate Subscriber ಒತ್ತಬೇಕು. ಈ ಡೆಮೋದಲ್ಲಿ ನಾನು ಅದನ್ನು ಒತ್ತುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ಗ್ರಾಹಕ ಉಳಿಯುವುದಿಲ್ಲ. ಬದಲಿಗೆ ಫಾರ್ಮ್ ಮುಚ್ಚುತ್ತೇನೆ.',
      ),
    },
  },
  {
    key: 'demo.cleanup',
    title: 'Removing the demo items',
    text: {
      en: english('Now I remove the demo cables and boxes, so your map is the same as before.'),
      te: draft('ఇప్పుడు డెమో cables, boxesను తీసేస్తాను, మీ మ్యాప్ ముందులాగే ఉంటుంది.'),
      kn: draft('ಈಗ ಡೆಮೋ ಕೇಬಲ್‌ಗಳು ಮತ್ತು ಬಾಕ್ಸ್‌ಗಳನ್ನು ತೆಗೆಯುತ್ತೇನೆ, ನಿಮ್ಮ ನಕ್ಷೆ ಮೊದಲಿನಂತೆಯೇ ಇರುತ್ತದೆ.'),
    },
  },
  {
    key: 'demo.done',
    title: 'That is the whole flow',
    terms: ['Try it yourself'],
    text: {
      en: english(
        "That is the whole flow, from the ISP to the customer's devices. To do it yourself, tap Guide and choose Try it yourself. I will wait for you at each step.",
      ),
      te: draft(
        'ISP నుండి కస్టమర్ పరికరాల వరకు మొత్తం విధానం ఇదే. మీరే చేయాలంటే Guide నొక్కి Try it yourself ఎంచుకోండి. ప్రతి దశలో నేను మీ కోసం ఎదురుచూస్తాను.',
      ),
      kn: draft(
        'ISPಯಿಂದ ಗ್ರಾಹಕರ ಉಪಕರಣಗಳವರೆಗಿನ ಇಡೀ ವಿಧಾನ ಇದೇ. ನೀವೇ ಮಾಡಲು Guide ಒತ್ತಿ Try it yourself ಆಯ್ಕೆ ಮಾಡಿ. ಪ್ರತಿ ಹಂತದಲ್ಲಿ ನಾನು ನಿಮಗಾಗಿ ಕಾಯುತ್ತೇನೆ.',
      ),
    },
  },
  ...FLOW_SCRIPTS(),
];

/**
 * The self-running demo's full flow, from the ISP to the customer's devices (`flow.*`). Steps the app
 * can record are done on the real map; the office links above the OLT and the parts inside the house
 * are explained only, because the app does not record them yet.
 */
function FLOW_SCRIPTS(): LessonScript[] {
  const s = (key: string, title: string, en: string, te: string, kn: string, terms?: string[]): LessonScript => ({
    key: `flow.${key}`,
    title,
    ...(terms ? { terms } : {}),
    text: { en: english(en), te: draft(te), kn: draft(kn) },
  });
  return [
    s(
      'isp',
      'Where the internet comes from',
      'First, where the internet comes from. Your upstream ISP sends the internet into your office on a big fibre link. Everything you map starts from here.',
      'ముందుగా, ఇంటర్నెట్ ఎక్కడి నుండి వస్తుందో. పై ISP పెద్ద ఫైబర్ లింక్ ద్వారా మీ ఆఫీసుకి ఇంటర్నెట్ పంపుతుంది. మీరు మ్యాప్ చేసేది అంతా ఇక్కడి నుండే మొదలవుతుంది.',
      'ಮೊದಲು, ಇಂಟರ್ನೆಟ್ ಎಲ್ಲಿಂದ ಬರುತ್ತದೆ. ಮೇಲಿನ ISP ದೊಡ್ಡ ಫೈಬರ್ ಲಿಂಕ್ ಮೂಲಕ ನಿಮ್ಮ ಕಚೇರಿಗೆ ಇಂಟರ್ನೆಟ್ ಕಳುಹಿಸುತ್ತದೆ. ನೀವು ನಕ್ಷೆ ಮಾಡುವುದೆಲ್ಲಾ ಇಲ್ಲಿಂದಲೇ ಶುರುವಾಗುತ್ತದೆ.',
      ['ISP'],
    ),
    s(
      'edgeRouter',
      'Edge router',
      'The ISP link ends on the edge router. It is the door between your network and the internet.',
      'ISP లింక్ edge routerలో ముగుస్తుంది. ఇది మీ నెట్‌వర్క్‌కి, ఇంటర్నెట్‌కి మధ్య ద్వారం.',
      'ISP ಲಿಂಕ್ edge routerನಲ್ಲಿ ಕೊನೆಯಾಗುತ್ತದೆ. ಇದು ನಿಮ್ಮ ನೆಟ್‌ವರ್ಕ್ ಮತ್ತು ಇಂಟರ್ನೆಟ್ ನಡುವಿನ ಬಾಗಿಲು.',
      ['Edge router'],
    ),
    s(
      'bng',
      'BNG or BRAS',
      'Next is the BNG, also called BRAS. Each customer logs in here with a user name, and it gives them their speed plan.',
      'తర్వాత BNG, దీన్ని BRAS అని కూడా అంటారు. ప్రతి కస్టమర్ ఇక్కడ యూజర్ నేమ్‌తో లాగిన్ అవుతారు, వారి స్పీడ్ ప్లాన్ ఇక్కడే ఇస్తుంది.',
      'ಮುಂದೆ BNG, ಇದನ್ನು BRAS ಎಂದೂ ಕರೆಯುತ್ತಾರೆ. ಪ್ರತಿ ಗ್ರಾಹಕ ಇಲ್ಲಿ ಯೂಸರ್ ನೇಮ್‌ನಿಂದ ಲಾಗಿನ್ ಆಗುತ್ತಾರೆ, ಅವರ ಸ್ಪೀಡ್ ಪ್ಲಾನ್ ಇಲ್ಲೇ ಸಿಗುತ್ತದೆ.',
      ['BNG', 'BRAS'],
    ),
    s(
      'coreRouter',
      'Core router',
      'The core router sends the traffic the right way inside your network.',
      'core router మీ నెట్‌వర్క్ లోపల ట్రాఫిక్‌ను సరైన దారిలో పంపుతుంది.',
      'core router ನಿಮ್ಮ ನೆಟ್‌ವರ್ಕ್ ಒಳಗೆ ಟ್ರಾಫಿಕ್ ಅನ್ನು ಸರಿಯಾದ ದಾರಿಯಲ್ಲಿ ಕಳುಹಿಸುತ್ತದೆ.',
      ['Core router'],
    ),
    s(
      'coreSwitch',
      'Core switch',
      'The core switch joins the routers and the big links together in the office.',
      'core switch ఆఫీసులో రౌటర్లను, పెద్ద లింకులను కలుపుతుంది.',
      'core switch ಕಚೇರಿಯಲ್ಲಿ ರೂಟರ್‌ಗಳನ್ನು ಮತ್ತು ದೊಡ್ಡ ಲಿಂಕ್‌ಗಳನ್ನು ಸೇರಿಸುತ್ತದೆ.',
      ['Core switch'],
    ),
    s(
      'aggSwitch',
      'Aggregation switch',
      'The aggregation switch collects the links of many OLTs and sends them to the core.',
      'aggregation switch చాలా OLTల లింకులను సేకరించి coreకి పంపుతుంది.',
      'aggregation switch ಹಲವು OLTಗಳ ಲಿಂಕ್‌ಗಳನ್ನು ಒಟ್ಟುಗೂಡಿಸಿ coreಗೆ ಕಳುಹಿಸುತ್ತದೆ.',
      ['Aggregation switch'],
    ),
    s(
      'uplink',
      'Ethernet uplink to the OLT',
      'An Ethernet uplink cable joins the aggregation switch to the uplink port of the OLT. This app does not record these office links yet, so the map starts at the OLT.',
      'Ethernet uplink కేబుల్ aggregation switchను OLT uplink portకి కలుపుతుంది. ఈ ఆఫీసు లింకులను ఈ యాప్ ఇంకా రాయదు, కాబట్టి మ్యాప్ OLT నుండి మొదలవుతుంది.',
      'Ethernet uplink ಕೇಬಲ್ aggregation switch ಅನ್ನು OLT uplink portಗೆ ಸೇರಿಸುತ್ತದೆ. ಈ ಕಚೇರಿ ಲಿಂಕ್‌ಗಳನ್ನು ಈ ಆ್ಯಪ್ ಇನ್ನೂ ದಾಖಲಿಸುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ನಕ್ಷೆ OLTಯಿಂದ ಶುರುವಾಗುತ್ತದೆ.',
      ['Ethernet', 'Uplink'],
    ),
    s(
      'oltPanel',
      "The OLT's panel and its buttons",
      "This is the OLT's panel. Its tabs are Details, Specs, Connectivity, Customers, Documents, Maintenance and History. At the bottom, Configure OLT changes its ports, Trace follows the light, Navigate takes you there, and Delete removes it.",
      'ఇది OLT ప్యానెల్. దీనిలో Details, Specs, Connectivity, Customers, Documents, Maintenance, History ట్యాబ్‌లు ఉన్నాయి. కింద Configure OLT పోర్టులను మారుస్తుంది, Trace వెలుగు దారిని చూపిస్తుంది, Navigate అక్కడికి తీసుకెళ్తుంది, Delete దీన్ని తీసేస్తుంది.',
      'ಇದು OLT ಪ್ಯಾನೆಲ್. ಇದರಲ್ಲಿ Details, Specs, Connectivity, Customers, Documents, Maintenance, History ಟ್ಯಾಬ್‌ಗಳಿವೆ. ಕೆಳಗೆ Configure OLT ಪೋರ್ಟ್‌ಗಳನ್ನು ಬದಲಿಸುತ್ತದೆ, Trace ಬೆಳಕಿನ ದಾರಿ ತೋರಿಸುತ್ತದೆ, Navigate ಅಲ್ಲಿಗೆ ಕರೆದೊಯ್ಯುತ್ತದೆ, Delete ಇದನ್ನು ತೆಗೆಯುತ್ತದೆ.',
      ['Configure OLT', 'Trace', 'Navigate', 'Delete'],
    ),
    s(
      'oltConnect',
      'Inside the OLT',
      'Now I open the Connectivity tab. Here is what is inside the OLT.',
      'ఇప్పుడు Connectivity ట్యాబ్ తెరుస్తాను. OLT లోపల ఏముందో ఇక్కడ ఉంటుంది.',
      'ಈಗ Connectivity ಟ್ಯಾಬ್ ತೆರೆಯುತ್ತೇನೆ. OLT ಒಳಗೆ ಏನಿದೆ ಎಂಬುದು ಇಲ್ಲಿದೆ.',
      ['Connectivity'],
    ),
    s(
      'chassis',
      'Chassis, slots and cards',
      'Chassis: the OLT body has shelves, each shelf has slots, and each slot holds a card. A PON card has the PON ports, and an uplink card has the uplink ports. Tap Record shelves and cards, add a shelf and its slots, choose each card, then tap Save chassis.',
      'Chassis: OLT బాడీలో షెల్ఫ్‌లు ఉంటాయి, ప్రతి షెల్ఫ్‌లో స్లాట్లు, ప్రతి స్లాట్‌లో ఒక కార్డ్ ఉంటుంది. PON కార్డ్‌లో PON పోర్టులు, uplink కార్డ్‌లో uplink పోర్టులు ఉంటాయి. Record shelves and cards నొక్కి, షెల్ఫ్, స్లాట్లు జోడించి, ప్రతి కార్డ్ ఎంచుకుని, Save chassis నొక్కండి.',
      'Chassis: OLT ದೇಹದಲ್ಲಿ ಶೆಲ್ಫ್‌ಗಳಿವೆ, ಪ್ರತಿ ಶೆಲ್ಫ್‌ನಲ್ಲಿ ಸ್ಲಾಟ್‌ಗಳು, ಪ್ರತಿ ಸ್ಲಾಟ್‌ನಲ್ಲಿ ಒಂದು ಕಾರ್ಡ್ ಇರುತ್ತದೆ. PON ಕಾರ್ಡ್‌ನಲ್ಲಿ PON ಪೋರ್ಟ್‌ಗಳು, uplink ಕಾರ್ಡ್‌ನಲ್ಲಿ uplink ಪೋರ್ಟ್‌ಗಳು ಇರುತ್ತವೆ. Record shelves and cards ಒತ್ತಿ, ಶೆಲ್ಫ್ ಮತ್ತು ಸ್ಲಾಟ್‌ಗಳನ್ನು ಸೇರಿಸಿ, ಪ್ರತಿ ಕಾರ್ಡ್ ಆಯ್ಕೆ ಮಾಡಿ, Save chassis ಒತ್ತಿ.',
      ['Record shelves and cards', 'Save chassis'],
    ),
    s(
      'uplinkPort',
      'OLT uplink port',
      'The uplink port is on the uplink card. The Ethernet cable from the switch plugs in here. In this app you record only how many uplink ports the card has.',
      'uplink port uplink కార్డ్‌పై ఉంటుంది. switch నుండి Ethernet కేబుల్ ఇక్కడ పెడతారు. ఈ యాప్‌లో కార్డ్‌కి ఎన్ని uplink పోర్టులు ఉన్నాయో మాత్రమే రాస్తారు.',
      'uplink port uplink ಕಾರ್ಡ್ ಮೇಲೆ ಇರುತ್ತದೆ. switchನಿಂದ Ethernet ಕೇಬಲ್ ಇಲ್ಲಿ ಹಾಕುತ್ತಾರೆ. ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಾರ್ಡ್‌ಗೆ ಎಷ್ಟು uplink ಪೋರ್ಟ್‌ಗಳಿವೆ ಎಂಬುದನ್ನು ಮಾತ್ರ ದಾಖಲಿಸುತ್ತಾರೆ.',
      ['Uplink port'],
    ),
    s(
      'ponPort',
      'OLT PON ports',
      'PON ports: each PON port sends light to the customers on one line. Choose a Port, write its address and light levels, and tap Save port. Patch cords and fibres are joined to these ports.',
      'PON ports: ప్రతి PON port ఒక లైన్‌లోని కస్టమర్లకు వెలుగు పంపుతుంది. Port ఎంచుకుని, దాని address, వెలుగు స్థాయిలు రాసి, Save port నొక్కండి. patch cordలు, ఫైబర్లు ఈ పోర్టులకు కలుస్తాయి.',
      'PON ports: ಪ್ರತಿ PON port ಒಂದು ಲೈನ್‌ನ ಗ್ರಾಹಕರಿಗೆ ಬೆಳಕು ಕಳುಹಿಸುತ್ತದೆ. Port ಆಯ್ಕೆ ಮಾಡಿ, ಅದರ address, ಬೆಳಕಿನ ಮಟ್ಟಗಳನ್ನು ಬರೆದು, Save port ಒತ್ತಿ. patch cordಗಳು, ಫೈಬರ್‌ಗಳು ಈ ಪೋರ್ಟ್‌ಗಳಿಗೆ ಸೇರುತ್ತವೆ.',
      ['PON port', 'Save port'],
    ),
    s(
      'odfList',
      'ODF: open the list',
      'Next the ODF, the frame where all the fibres in the office end. I open Equipment.',
      'తర్వాత ODF, ఆఫీసులో అన్ని ఫైబర్లు ముగిసే ఫ్రేమ్. Equipment తెరుస్తాను.',
      'ಮುಂದೆ ODF, ಕಚೇರಿಯಲ್ಲಿ ಎಲ್ಲಾ ಫೈಬರ್‌ಗಳು ಕೊನೆಗೊಳ್ಳುವ ಫ್ರೇಮ್. Equipment ತೆರೆಯುತ್ತೇನೆ.',
      ['ODF', 'Equipment'],
    ),
    s(
      'odfPick',
      'ODF: choose it',
      'I choose Optical Distribution Frame, ODF.',
      'Optical Distribution Frame, ODF ఎంచుకుంటాను.',
      'Optical Distribution Frame, ODF ಆಯ್ಕೆ ಮಾಡುತ್ತೇನೆ.',
      ['Optical Distribution Frame (ODF)'],
    ),
    s(
      'odfPlace',
      'ODF: place it',
      'I tap the map beside the OLT, in the same office.',
      'అదే ఆఫీసులో, OLT పక్కన మ్యాప్‌పై నొక్కుతాను.',
      'ಅದೇ ಕಚೇರಿಯಲ್ಲಿ, OLT ಪಕ್ಕದಲ್ಲಿ ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತುತ್ತೇನೆ.',
    ),
    s(
      'odfPanel',
      'ODF: add a panel',
      'An ODF has panels, and each panel has adapter ports. In Connectivity, I write the panel name and how many adapters it has, then tap Add panel.',
      'ODFలో ప్యానెళ్లు ఉంటాయి, ప్రతి ప్యానెల్‌లో adapter పోర్టులు ఉంటాయి. Connectivityలో ప్యానెల్ పేరు, ఎన్ని adapterలు ఉన్నాయో రాసి, Add panel నొక్కుతాను.',
      'ODFನಲ್ಲಿ ಪ್ಯಾನೆಲ್‌ಗಳಿವೆ, ಪ್ರತಿ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ adapter ಪೋರ್ಟ್‌ಗಳಿವೆ. Connectivityಯಲ್ಲಿ ಪ್ಯಾನೆಲ್ ಹೆಸರು, ಎಷ್ಟು adapterಗಳಿವೆ ಎಂದು ಬರೆದು, Add panel ಒತ್ತುತ್ತೇನೆ.',
      ['Add panel'],
    ),
    s(
      'odfPatch',
      'Patch cord: OLT to ODF',
      'An optical patch cord joins OLT PON port 1 to ODF port 1. I tap port 1, choose the OLT and its PON port, and tap Save patch.',
      'optical patch cord OLT PON port 1ను ODF port 1కి కలుపుతుంది. port 1 నొక్కి, OLT, దాని PON port ఎంచుకుని, Save patch నొక్కుతాను.',
      'optical patch cord OLT PON port 1 ಅನ್ನು ODF port 1ಕ್ಕೆ ಸೇರಿಸುತ್ತದೆ. port 1 ಒತ್ತಿ, OLT ಮತ್ತು ಅದರ PON port ಆಯ್ಕೆ ಮಾಡಿ, Save patch ಒತ್ತುತ್ತೇನೆ.',
      ['Patch cord', 'Save patch'],
    ),
    s(
      'odfButtons',
      "The ODF port's buttons",
      'Each ODF port has a front and a back. The front is the patch cord to the OLT. The back is the pigtail and the feeder fibre. Mark faulty is for a broken adapter, Reserve keeps a port for later, and Record pigtail writes the pigtail details.',
      'ప్రతి ODF portకి ముందు, వెనుక ఉంటాయి. ముందు OLTకి patch cord. వెనుక pigtail, feeder ఫైబర్. పగిలిన adapterకి Mark faulty, తర్వాతి కోసం port ఉంచడానికి Reserve, pigtail వివరాలకు Record pigtail.',
      'ಪ್ರತಿ ODF portಗೆ ಮುಂದು ಮತ್ತು ಹಿಂದು ಇವೆ. ಮುಂದೆ OLTಗೆ patch cord. ಹಿಂದೆ pigtail ಮತ್ತು feeder ಫೈಬರ್. ಒಡೆದ adapterಗೆ Mark faulty, ನಂತರಕ್ಕಾಗಿ port ಇಡಲು Reserve, pigtail ವಿವರಗಳಿಗೆ Record pigtail.',
      ['Mark faulty', 'Reserve', 'Record pigtail'],
    ),
    s(
      'feederSelect',
      'Feeder cable: tap the ODF',
      'Now the feeder cable, from the ODF to the FDT cabinet. I tap the ODF.',
      'ఇప్పుడు feeder cable, ODF నుండి FDT క్యాబినెట్ వరకు. ODF నొక్కుతాను.',
      'ಈಗ feeder cable, ODFನಿಂದ FDT ಕ್ಯಾಬಿನೆಟ್‌ವರೆಗೆ. ODF ಒತ್ತುತ್ತೇನೆ.',
      ['Feeder cable'],
    ),
    s(
      'feederStart',
      'Feeder cable: start it',
      'In Details, I tap Start cable here.',
      'Detailsలో Start cable here నొక్కుతాను.',
      'Detailsನಲ್ಲಿ Start cable here ಒತ್ತುತ್ತೇನೆ.',
      ['Start cable here'],
    ),
    s(
      'feederRoute',
      'Feeder cable: along the road, on poles',
      'I switch on Auto-pole, then tap along the road. At each tap a pole is placed, and the cable hangs from pole to pole. I end on the FDT and tap Finish.',
      'Auto-pole ఆన్ చేసి, రోడ్డు వెంట నొక్కుతాను. ప్రతి నొక్కుకి ఒక స్తంభం పెడుతుంది, కేబుల్ స్తంభం నుండి స్తంభానికి వేలాడుతుంది. FDT పై ముగించి Finish నొక్కుతాను.',
      'Auto-pole ಆನ್ ಮಾಡಿ, ರಸ್ತೆಯುದ್ದಕ್ಕೂ ಒತ್ತುತ್ತೇನೆ. ಪ್ರತಿ ಒತ್ತಿಗೂ ಒಂದು ಕಂಬ ಇಡುತ್ತದೆ, ಕೇಬಲ್ ಕಂಬದಿಂದ ಕಂಬಕ್ಕೆ ನೇತಾಡುತ್ತದೆ. FDT ಮೇಲೆ ಮುಗಿಸಿ Finish ಒತ್ತುತ್ತೇನೆ.',
      ['Auto-pole', 'Finish'],
    ),
    s(
      'feederKind',
      'Feeder cable: kind and fibres',
      'The Save Cable window opens. I choose Main Feeder Fiber and name it. The next page shows how many fibres it has, in tubes, each fibre with its own colour.',
      'Save Cable విండో తెరుచుకుంటుంది. Main Feeder Fiber ఎంచుకుని పేరు పెడతాను. తర్వాతి పేజీలో దానిలో ఎన్ని ఫైబర్లు ఉన్నాయో, ట్యూబుల్లో, ప్రతి ఫైబర్‌కి దాని రంగుతో ఉంటుంది.',
      'Save Cable ಕಿಟಕಿ ತೆರೆಯುತ್ತದೆ. Main Feeder Fiber ಆಯ್ಕೆ ಮಾಡಿ ಹೆಸರಿಡುತ್ತೇನೆ. ಮುಂದಿನ ಪುಟದಲ್ಲಿ ಅದರಲ್ಲಿ ಎಷ್ಟು ಫೈಬರ್‌ಗಳಿವೆ, ಟ್ಯೂಬ್‌ಗಳಲ್ಲಿ, ಪ್ರತಿ ಫೈಬರ್‌ಗೆ ಅದರದೇ ಬಣ್ಣ ಇರುತ್ತದೆ.',
      ['Main Feeder Fiber'],
    ),
    s(
      'feederEnds',
      'Feeder cable: its two ends',
      'Ends: the line touches the ODF and the FDT. I tap Yes, connect.',
      'Ends: లైన్ ODFను, FDTను తాకుతుంది. Yes, connect నొక్కుతాను.',
      'Ends: ಲೈನ್ ODF ಮತ್ತು FDT ಅನ್ನು ಮುಟ್ಟುತ್ತದೆ. Yes, connect ಒತ್ತುತ್ತೇನೆ.',
      ['Yes, connect'],
    ),
    s(
      'feederPoles',
      'Feeder cable: the poles it hangs on',
      'Poles: the poles on the line are listed. I tick the ones that carry this cable, and choose Yes, it is on them. Under it, Is it in a duct is for cable under the ground.',
      'Poles: లైన్‌పై ఉన్న స్తంభాల జాబితా వస్తుంది. ఈ కేబుల్‌ను మోసేవాటిని టిక్ చేసి, Yes, it is on them ఎంచుకుంటాను. కింద Is it in a duct భూమి కింద కేబుల్ కోసం.',
      'Poles: ಲೈನ್ ಮೇಲಿನ ಕಂಬಗಳ ಪಟ್ಟಿ ಬರುತ್ತದೆ. ಈ ಕೇಬಲ್ ಹೊರುವವನ್ನು ಟಿಕ್ ಮಾಡಿ, Yes, it is on them ಆಯ್ಕೆ ಮಾಡುತ್ತೇನೆ. ಕೆಳಗೆ Is it in a duct ನೆಲದಡಿಯ ಕೇಬಲ್‌ಗಾಗಿ.',
      ['Yes, it is on them'],
    ),
    s(
      'feederSlack',
      'Feeder cable: slack loop',
      'Slack: extra cable is left coiled on a pole for repairs later. I tap Add a slack loop, choose the pole and write 20 metres.',
      'Slack: తర్వాత రిపేర్ల కోసం అదనపు కేబుల్‌ను స్తంభంపై చుట్టగా ఉంచుతారు. Add a slack loop నొక్కి, స్తంభం ఎంచుకుని, 20 మీటర్లు రాస్తాను.',
      'Slack: ನಂತರದ ರಿಪೇರಿಗಾಗಿ ಹೆಚ್ಚುವರಿ ಕೇಬಲ್ ಅನ್ನು ಕಂಬದ ಮೇಲೆ ಸುರುಳಿಯಾಗಿ ಇಡುತ್ತಾರೆ. Add a slack loop ಒತ್ತಿ, ಕಂಬ ಆಯ್ಕೆ ಮಾಡಿ, 20 ಮೀಟರ್ ಬರೆಯುತ್ತೇನೆ.',
      ['Add a slack loop'],
    ),
    s(
      'feederSave',
      'Feeder cable: save it',
      'The last page is Check. I tap Save Cable. The feeder is now on the map, on its poles.',
      'చివరి పేజీ Check. Save Cable నొక్కుతాను. feeder ఇప్పుడు మ్యాప్‌పై, దాని స్తంభాలపై ఉంది.',
      'ಕೊನೆಯ ಪುಟ Check. Save Cable ಒತ್ತುತ್ತೇನೆ. feeder ಈಗ ನಕ್ಷೆಯಲ್ಲಿ, ಅದರ ಕಂಬಗಳ ಮೇಲೆ ಇದೆ.',
      ['Save Cable'],
    ),
    s(
      'feederStop',
      'Feeder cable: stop drawing',
      'I switch Auto-pole off and tap Select, so the next tap does not start another cable.',
      'Auto-pole ఆఫ్ చేసి Select నొక్కుతాను, అప్పుడు తర్వాతి నొక్కు మరో కేబుల్ మొదలుపెట్టదు.',
      'Auto-pole ಆಫ್ ಮಾಡಿ Select ಒತ್ತುತ್ತೇನೆ, ಆಗ ಮುಂದಿನ ಒತ್ತು ಇನ್ನೊಂದು ಕೇಬಲ್ ಶುರುಮಾಡುವುದಿಲ್ಲ.',
      ['Select'],
    ),
    s(
      'ducts',
      'Under the ground: ducts and manholes',
      'Where the cable goes under the ground, it runs in a duct, a pipe. You reach it at manholes, handholes and chambers. Place a manhole from Equipment, then in its panel tap Start duct here to draw the duct to the next one.',
      'కేబుల్ భూమి కిందకి వెళ్ళే చోట, అది duct అనే పైపులో వెళ్తుంది. manhole, handhole, chamber వద్ద దాన్ని చేరుకుంటారు. Equipment నుండి manhole పెట్టి, దాని ప్యానెల్‌లో Start duct here నొక్కి తర్వాతి దాని వరకు duct గీయండి.',
      'ಕೇಬಲ್ ನೆಲದಡಿಗೆ ಹೋಗುವ ಜಾಗದಲ್ಲಿ, ಅದು duct ಎಂಬ ಪೈಪ್‌ನಲ್ಲಿ ಹೋಗುತ್ತದೆ. manhole, handhole, chamber ಬಳಿ ಅದನ್ನು ತಲುಪುತ್ತಾರೆ. Equipmentನಿಂದ manhole ಇಟ್ಟು, ಅದರ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ Start duct here ಒತ್ತಿ ಮುಂದಿನದರವರೆಗೆ duct ಬರೆಯಿರಿ.',
      ['Duct', 'Manhole', 'Handhole', 'Start duct here'],
    ),
    s(
      'odfFeeder',
      'ODF: the feeder fibre behind port 1',
      'Back at the ODF: behind port 1, the pigtail is joined to feeder fibre 1. I open port 1, choose the feeder cable and fibre 1, and tap Save feeder fiber.',
      'మళ్ళీ ODF వద్ద: port 1 వెనుక pigtail feeder ఫైబర్ 1కి కలుస్తుంది. port 1 తెరిచి, feeder cable, ఫైబర్ 1 ఎంచుకుని, Save feeder fiber నొక్కుతాను.',
      'ಮತ್ತೆ ODF ಬಳಿ: port 1ರ ಹಿಂದೆ pigtail feeder ಫೈಬರ್ 1ಕ್ಕೆ ಸೇರುತ್ತದೆ. port 1 ತೆರೆದು, feeder cable ಮತ್ತು ಫೈಬರ್ 1 ಆಯ್ಕೆ ಮಾಡಿ, Save feeder fiber ಒತ್ತುತ್ತೇನೆ.',
      ['Pigtail', 'Save feeder fiber'],
    ),
    s(
      'fusion',
      'Fusion splice',
      'That join is a fusion splice: a splicing machine melts the two glass fibres together. A good splice loses very little light, about 0.1 dB.',
      'ఆ కలయిక fusion splice: splicing మెషిన్ రెండు గాజు ఫైబర్లను కరిగించి కలుపుతుంది. మంచి splice చాలా తక్కువ వెలుగు కోల్పోతుంది, దాదాపు 0.1 dB.',
      'ಆ ಜೋಡಣೆ fusion splice: splicing ಯಂತ್ರ ಎರಡು ಗಾಜಿನ ಫೈಬರ್‌ಗಳನ್ನು ಕರಗಿಸಿ ಸೇರಿಸುತ್ತದೆ. ಒಳ್ಳೆಯ splice ತುಂಬಾ ಕಡಿಮೆ ಬೆಳಕು ಕಳೆದುಕೊಳ್ಳುತ್ತದೆ, ಸುಮಾರು 0.1 dB.',
      ['Fusion splice'],
    ),
    s(
      'closure',
      'Splice closure and trays',
      'On a long route, two cables are joined in a splice closure. Inside are splice trays, and each incoming fibre is spliced to an outgoing fibre. Place a Dome Joint Closure, tap Set up closure, then Splices and trays, and Save splice for each fibre.',
      'పొడవైన దారిలో రెండు కేబుళ్లను splice closureలో కలుపుతారు. లోపల splice trayలు ఉంటాయి, ప్రతి లోపలికి వచ్చే ఫైబర్‌ను బయటికి వెళ్ళే ఫైబర్‌కి splice చేస్తారు. Dome Joint Closure పెట్టి, Set up closure, తర్వాత Splices and trays నొక్కి, ప్రతి ఫైబర్‌కి Save splice నొక్కండి.',
      'ಉದ್ದದ ದಾರಿಯಲ್ಲಿ ಎರಡು ಕೇಬಲ್‌ಗಳನ್ನು splice closureನಲ್ಲಿ ಸೇರಿಸುತ್ತಾರೆ. ಒಳಗೆ splice trayಗಳಿವೆ, ಪ್ರತಿ ಒಳಬರುವ ಫೈಬರ್ ಅನ್ನು ಹೊರಹೋಗುವ ಫೈಬರ್‌ಗೆ splice ಮಾಡುತ್ತಾರೆ. Dome Joint Closure ಇಟ್ಟು, Set up closure, ನಂತರ Splices and trays ಒತ್ತಿ, ಪ್ರತಿ ಫೈಬರ್‌ಗೆ Save splice ಒತ್ತಿ.',
      ['Splice closure', 'Splice tray', 'Save splice'],
    ),
    s(
      'fdtOpen',
      'FDT: where the feeder ends',
      'The feeder ends at the FDT cabinet. I tap the FDT.',
      'feeder FDT క్యాబినెట్ వద్ద ముగుస్తుంది. FDT నొక్కుతాను.',
      'feeder FDT ಕ್ಯಾಬಿನೆಟ್ ಬಳಿ ಕೊನೆಯಾಗುತ್ತದೆ. FDT ಒತ್ತುತ್ತೇನೆ.',
      ['FDT'],
    ),
    s(
      'fdtSplitter',
      'FDT: the primary splitter',
      'Inside the FDT is the primary PLC splitter. Feeder fibre 1 goes into its input. In Connectivity I choose 1:8, choose the feeder cable and fibre 1, and tap Add splitter.',
      'FDT లోపల primary PLC splitter ఉంటుంది. feeder ఫైబర్ 1 దాని inputలోకి వెళ్తుంది. Connectivityలో 1:8 ఎంచుకుని, feeder cable, ఫైబర్ 1 ఎంచుకుని, Add splitter నొక్కుతాను.',
      'FDT ಒಳಗೆ primary PLC splitter ಇರುತ್ತದೆ. feeder ಫೈಬರ್ 1 ಅದರ inputಗೆ ಹೋಗುತ್ತದೆ. Connectivityಯಲ್ಲಿ 1:8 ಆಯ್ಕೆ ಮಾಡಿ, feeder cable ಮತ್ತು ಫೈಬರ್ 1 ಆಯ್ಕೆ ಮಾಡಿ, Add splitter ಒತ್ತುತ್ತೇನೆ.',
      ['PLC splitter', 'Add splitter'],
    ),
    s(
      'fdtButtons',
      "The splitter's ports and buttons",
      'The splitter shows its input and its 8 output ports. Tap an output to see what is on it. Mark faulty, Reserve and Connect output are there. Unlink input takes the feeder fibre off.',
      'splitter దాని input, 8 output పోర్టులు చూపిస్తుంది. output నొక్కితే దానిపై ఏముందో కనిపిస్తుంది. అక్కడ Mark faulty, Reserve, Connect output ఉన్నాయి. Unlink input feeder ఫైబర్‌ను తీసేస్తుంది.',
      'splitter ಅದರ input ಮತ್ತು 8 output ಪೋರ್ಟ್‌ಗಳನ್ನು ತೋರಿಸುತ್ತದೆ. output ಒತ್ತಿದರೆ ಅದರ ಮೇಲೆ ಏನಿದೆ ಎಂದು ಕಾಣುತ್ತದೆ. ಅಲ್ಲಿ Mark faulty, Reserve, Connect output ಇವೆ. Unlink input feeder ಫೈಬರ್ ಅನ್ನು ತೆಗೆಯುತ್ತದೆ.',
      ['Connect output', 'Unlink input'],
    ),
    s(
      'fdtOutput',
      'Splitter output to the distribution cable',
      'Splitter output 1 goes into distribution fibre 1. I tap the FDT, open output 1, choose the distribution cable and fibre 1, and tap Connect output.',
      'splitter output 1 distribution ఫైబర్ 1లోకి వెళ్తుంది. FDT నొక్కి, output 1 తెరిచి, distribution cable, ఫైబర్ 1 ఎంచుకుని, Connect output నొక్కుతాను.',
      'splitter output 1 distribution ಫೈಬರ್ 1ಕ್ಕೆ ಹೋಗುತ್ತದೆ. FDT ಒತ್ತಿ, output 1 ತೆರೆದು, distribution cable ಮತ್ತು ಫೈಬರ್ 1 ಆಯ್ಕೆ ಮಾಡಿ, Connect output ಒತ್ತುತ್ತೇನೆ.',
      ['Connect output'],
    ),
    s(
      'intermediate',
      'Closures on the way',
      'On a long distribution route there can be more closures in between, joined the same way, fibre to fibre. The splitter in the FAT, next, is the second splitter.',
      'పొడవైన distribution దారిలో మధ్యలో మరిన్ని closureలు ఉండవచ్చు, అదే విధంగా ఫైబర్‌కి ఫైబర్ కలుపుతారు. తర్వాత FATలోని splitter రెండో splitter.',
      'ಉದ್ದದ distribution ದಾರಿಯಲ್ಲಿ ನಡುವೆ ಇನ್ನಷ್ಟು closureಗಳು ಇರಬಹುದು, ಅದೇ ರೀತಿ ಫೈಬರ್‌ನಿಂದ ಫೈಬರ್‌ಗೆ ಸೇರಿಸುತ್ತಾರೆ. ಮುಂದೆ FATನಲ್ಲಿರುವ splitter ಎರಡನೇ splitter.',
    ),
    s(
      'fatOpen',
      'FAT: where the distribution cable ends',
      'The distribution cable ends at the FAT box. I tap the FAT.',
      'distribution cable FAT box వద్ద ముగుస్తుంది. FAT నొక్కుతాను.',
      'distribution cable FAT box ಬಳಿ ಕೊನೆಯಾಗುತ್ತದೆ. FAT ಒತ್ತುತ್ತೇನೆ.',
      ['FAT'],
    ),
    s(
      'fatSplitter',
      'FAT: the second splitter',
      'Inside the FAT is the second splitter. Distribution fibre 1 goes into its input. I choose 1:8, choose the distribution cable and fibre 1, and tap Add splitter.',
      'FAT లోపల రెండో splitter ఉంటుంది. distribution ఫైబర్ 1 దాని inputలోకి వెళ్తుంది. 1:8 ఎంచుకుని, distribution cable, ఫైబర్ 1 ఎంచుకుని, Add splitter నొక్కుతాను.',
      'FAT ಒಳಗೆ ಎರಡನೇ splitter ಇರುತ್ತದೆ. distribution ಫೈಬರ್ 1 ಅದರ inputಗೆ ಹೋಗುತ್ತದೆ. 1:8 ಆಯ್ಕೆ ಮಾಡಿ, distribution cable ಮತ್ತು ಫೈಬರ್ 1 ಆಯ್ಕೆ ಮಾಡಿ, Add splitter ಒತ್ತುತ್ತೇನೆ.',
      ['Add splitter'],
    ),
    s(
      'fatButtons',
      "The FAT's ports and tools",
      'The FAT input is its splitter input, and its output ports are the splitter outputs, one for each house. In Details, Tools has Port manager, Photos and annotations for box photos, and Connect what feeds this.',
      'FAT input దాని splitter input, దాని output పోర్టులు splitter outputలు, ప్రతి ఇంటికి ఒకటి. Detailsలో Toolsలో Port manager, బాక్స్ ఫోటోల కోసం Photos and annotations, Connect what feeds this ఉన్నాయి.',
      'FAT input ಅದರ splitter input, ಅದರ output ಪೋರ್ಟ್‌ಗಳು splitter outputಗಳು, ಪ್ರತಿ ಮನೆಗೆ ಒಂದು. Detailsನಲ್ಲಿ Toolsನಲ್ಲಿ Port manager, ಬಾಕ್ಸ್ ಫೋಟೋಗಳಿಗೆ Photos and annotations, Connect what feeds this ಇವೆ.',
      ['Port manager', 'Photos and annotations', 'Connect what feeds this'],
    ),
    s(
      'drop',
      'Drop cable to the house',
      "When a customer is saved, a drop cable goes from the FAT output to the house, on the customer's poles or duct, and enters the building at the building entry point.",
      'కస్టమర్ సేవ్ అయినప్పుడు, FAT output నుండి ఇంటికి drop cable వెళ్తుంది, కస్టమర్ స్తంభాలు లేదా duct మీదుగా, building entry point వద్ద భవనంలోకి వెళ్తుంది.',
      'ಗ್ರಾಹಕ ಉಳಿಸಿದಾಗ, FAT outputನಿಂದ ಮನೆಗೆ drop cable ಹೋಗುತ್ತದೆ, ಗ್ರಾಹಕರ ಕಂಬಗಳು ಅಥವಾ duct ಮೂಲಕ, building entry point ಬಳಿ ಕಟ್ಟಡದೊಳಗೆ ಹೋಗುತ್ತದೆ.',
      ['Drop cable', 'Building entry'],
    ),
    s(
      'rosette',
      'Rosette and patch cord in the house',
      'Inside the house the drop ends in a small box on the wall, the rosette. A pigtail, an adapter and a short patch cord join it to the ONT.',
      'ఇంట్లో drop గోడపై చిన్న బాక్స్‌లో ముగుస్తుంది, అదే rosette. pigtail, adapter, చిన్న patch cord దాన్ని ONTకి కలుపుతాయి.',
      'ಮನೆಯೊಳಗೆ drop ಗೋಡೆಯ ಮೇಲಿನ ಸಣ್ಣ ಬಾಕ್ಸ್‌ನಲ್ಲಿ ಕೊನೆಯಾಗುತ್ತದೆ, ಅದೇ rosette. pigtail, adapter ಮತ್ತು ಚಿಕ್ಕ patch cord ಅದನ್ನು ONTಗೆ ಸೇರಿಸುತ್ತವೆ.',
      ['Rosette', 'Patch cord'],
    ),
    s(
      'ont',
      'ONT or ONU',
      'The ONT, or ONU, turns the light back into internet. Its serial number is written in the customer form. It has Ethernet LAN ports at the back.',
      'ONT లేదా ONU వెలుగును మళ్ళీ ఇంటర్నెట్‌గా మారుస్తుంది. దాని serial number కస్టమర్ ఫారంలో రాస్తారు. వెనుక Ethernet LAN పోర్టులు ఉంటాయి.',
      'ONT ಅಥವಾ ONU ಬೆಳಕನ್ನು ಮತ್ತೆ ಇಂಟರ್ನೆಟ್ ಆಗಿ ಬದಲಿಸುತ್ತದೆ. ಅದರ serial number ಗ್ರಾಹಕ ಫಾರ್ಮ್‌ನಲ್ಲಿ ಬರೆಯುತ್ತಾರೆ. ಹಿಂದೆ Ethernet LAN ಪೋರ್ಟ್‌ಗಳಿವೆ.',
      ['ONT', 'ONU', 'LAN port'],
    ),
    s(
      'lan',
      'Wi-Fi router and devices',
      "A LAN cable goes from the ONT LAN port to the customer's Wi-Fi router, and maybe to a LAN switch or access point. Phones, TVs and laptops connect to it. The app keeps only the router model, in the customer form.",
      'ONT LAN port నుండి కస్టమర్ Wi-Fi routerకి LAN cable వెళ్తుంది, కొన్నిసార్లు LAN switch లేదా access pointకి. ఫోన్లు, టీవీలు, ల్యాప్‌టాప్‌లు దానికి కలుస్తాయి. యాప్ కస్టమర్ ఫారంలో router model మాత్రమే ఉంచుతుంది.',
      'ONT LAN portನಿಂದ ಗ್ರಾಹಕರ Wi-Fi routerಗೆ LAN cable ಹೋಗುತ್ತದೆ, ಕೆಲವೊಮ್ಮೆ LAN switch ಅಥವಾ access pointಗೆ. ಫೋನ್, ಟಿವಿ, ಲ್ಯಾಪ್‌ಟಾಪ್‌ಗಳು ಅದಕ್ಕೆ ಸೇರುತ್ತವೆ. ಆ್ಯಪ್ ಗ್ರಾಹಕ ಫಾರ್ಮ್‌ನಲ್ಲಿ router model ಮಾತ್ರ ಇಡುತ್ತದೆ.',
      ['LAN cable', 'Wi-Fi router', 'Access point'],
    ),
  ];
}

/** The welcome lesson, in order. */
export const WELCOME_LESSON = [
  'welcome.intro',
  'welcome.what',
  'welcome.map',
  'welcome.path',
  'welcome.again',
] as const;

/**
 * The on-screen guides, in order: a tour of every menu page; mapping from the OLT to a house, done by
 * the person (map) or shown by the guide itself on the real map (demo).
 */
export const GUIDE_TOURS = {
  menu: [
    'menu.intro',
    'menu.map',
    'menu.view3d',
    'menu.twin',
    'menu.equipment',
    'menu.cables',
    'menu.customers',
    'menu.capture',
    'menu.operations',
    'menu.field',
    'menu.agent',
    'menu.onuFleet',
    'menu.trace',
    'menu.boxes',
    'menu.live',
    'menu.knowledge',
    'menu.admin',
    'menu.done',
  ],
  map: [
    'map.intro',
    'map.oltList',
    'map.oltPick',
    'map.oltPlace',
    'map.oltSetup',
    'map.fdtList',
    'map.fdtPick',
    'map.fdtPlace',
    'map.feederSelect',
    'map.feederStart',
    'map.feederRoute',
    'map.feederKind',
    'map.feederEnds',
    'map.feederSave',
    'map.feederStop',
    'map.fdtSplitterOpen',
    'map.fdtSplitterAdd',
    'map.fatList',
    'map.fatPick',
    'map.fatPlace',
    'map.distSelect',
    'map.distStart',
    'map.distRoute',
    'map.distKind',
    'map.distEnds',
    'map.distSave',
    'map.distStop',
    'map.custOpen',
    'map.custBox',
    'map.custSplitter',
    'map.custPort',
    'map.custPlace',
    'map.custSave',
    'map.check',
    'map.done',
  ],
  // The whole flow, ISP to the customer's devices. Above the OLT and inside the house it explains
  // only (the app does not record those links yet); from the OLT to the FAT it builds on the map.
  demo: [
    'demo.intro',
    // Upstream, in the office: explained.
    'flow.isp',
    'flow.edgeRouter',
    'flow.bng',
    'flow.coreRouter',
    'flow.coreSwitch',
    'flow.aggSwitch',
    'flow.uplink',
    // OLT, its panel, chassis, uplink and PON ports.
    'map.oltList',
    'map.oltPick',
    'map.oltPlace',
    'map.oltSetup',
    'flow.oltPanel',
    'flow.oltConnect',
    'flow.chassis',
    'flow.uplinkPort',
    'flow.ponPort',
    // ODF: panel, patch cord from the PON port.
    'flow.odfList',
    'flow.odfPick',
    'flow.odfPlace',
    'flow.odfPanel',
    'flow.odfPatch',
    'flow.odfButtons',
    // The FDT first, so the feeder has somewhere to end.
    'map.fdtList',
    'map.fdtPick',
    'map.fdtPlace',
    // Feeder cable from the ODF, on poles, with a slack loop.
    'flow.feederSelect',
    'flow.feederStart',
    'flow.feederRoute',
    'flow.feederKind',
    'flow.feederEnds',
    'flow.feederPoles',
    'flow.feederSlack',
    'flow.feederSave',
    'flow.feederStop',
    'flow.ducts',
    // The ODF pigtail spliced to the feeder fibre; closures.
    'flow.odfFeeder',
    'flow.fusion',
    'flow.closure',
    // FDT: feeder fibre into the primary splitter.
    'flow.fdtOpen',
    'flow.fdtSplitter',
    'flow.fdtButtons',
    'map.fatList',
    'map.fatPick',
    'map.fatPlace',
    'map.distSelect',
    'map.distStart',
    'map.distRoute',
    'map.distKind',
    'map.distEnds',
    'map.distSave',
    'map.distStop',
    // Splitter output into the distribution fibre; the FAT's second splitter.
    'flow.fdtOutput',
    'flow.intermediate',
    'flow.fatOpen',
    'flow.fatSplitter',
    'flow.fatButtons',
    'map.custOpen',
    'map.custBox',
    'map.custSplitter',
    'map.custPort',
    'map.custPlace',
    'demo.custSave',
    // To the house and inside it: explained.
    'flow.drop',
    'flow.rosette',
    'flow.ont',
    'flow.lan',
    'demo.cleanup',
    'demo.done',
  ],
} as const;
export type GuideTourId = keyof typeof GUIDE_TOURS;

export const isVoiceLanguage = (value: unknown): value is VoiceLanguage =>
  typeof value === 'string' && (VOICE_LANGUAGES as readonly string[]).includes(value);

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
