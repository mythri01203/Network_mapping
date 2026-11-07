import type { Catalog, DraftText } from './format';

/**
 * Words for the phone capture flow. English is the source. Every Telugu and Kannada text is a DRAFT
 * written without a native speaker or crew check: each one is `reviewed: false` and listed in
 * docs/LANGUAGE_REVIEW.md. Do not record audio from a draft. Change `reviewed` to true only after the
 * check described there, never in bulk.
 */
const d = (text: string): DraftText => ({ text, reviewed: false });

export const MESSAGES = {
  // Home
  'home.title': { en: 'Field capture', te: d('ఫీల్డ్ పని'), kn: d('ಫೀಲ್ಡ್ ಕೆಲಸ') },
  'home.addPole': { en: 'Add pole', te: d('పోల్ జోడించండి'), kn: d('ಕಂಬ ಸೇರಿಸಿ') },
  'home.addBox': { en: 'Add box', te: d('బాక్స్ జోడించండి'), kn: d('ಬಾಕ್ಸ್ ಸೇರಿಸಿ') },
  'home.addDrop': { en: 'Add customer drop', te: d('కస్టమర్ ఇంటి వైర్ జోడించండి'), kn: d('ಗ್ರಾಹಕರ ಮನೆ ವೈರ್ ಸೇರಿಸಿ') },
  'home.lightLevel': { en: 'Record light level', te: d('లైట్ లెవెల్ నమోదు చేయండి'), kn: d('ಲೈಟ್ ಲೆವೆಲ್ ದಾಖಲಿಸಿ') },
  'home.danger': { en: 'Report danger', te: d('ప్రమాదం తెలియజేయండి'), kn: d('ಅಪಾಯ ತಿಳಿಸಿ') },
  'home.callSupervisor': { en: 'Call supervisor', te: d('సూపర్‌వైజర్‌కు కాల్ చేయండి'), kn: d('ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ') },
  'home.help': { en: 'Help', te: d('సహాయం'), kn: d('ಸಹಾಯ') },
  'home.language': { en: 'Language', te: d('భాష'), kn: d('ಭಾಷೆ') },
  'home.officeMap': { en: 'Office map', te: d('ఆఫీస్ మ్యాప్'), kn: d('ಆಫೀಸ್ ನಕ್ಷೆ') },
  'home.continue': { en: 'Continue the unfinished one', te: d('ఆపినదాన్ని కొనసాగించండి'), kn: d('ಅರ್ಧ ಮಾಡಿದ್ದನ್ನು ಮುಂದುವರಿಸಿ') },
  'home.resumed': { en: 'Continuing where you stopped.', te: d('మీరు ఆపిన చోట నుండి కొనసాగుతోంది.'), kn: d('ನೀವು ನಿಲ್ಲಿಸಿದ ಕಡೆಯಿಂದ ಮುಂದುವರಿಯುತ್ತಿದೆ.') },

  // Sync chip
  'sync.saved': { en: 'Saved on phone {count}', te: d('ఫోన్‌లో సేవ్ అయింది {count}'), kn: d('ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ {count}') },
  'sync.sending': { en: 'Sending', te: d('పంపుతోంది'), kn: d('ಕಳುಹಿಸುತ್ತಿದೆ') },
  'sync.sent': { en: 'Sent to office', te: d('ఆఫీస్‌కు పంపబడింది'), kn: d('ಆಫೀಸ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ') },
  'sync.notSaved': { en: 'Not saved on phone', te: d('ఫోన్‌లో సేవ్ కాలేదు'), kn: d('ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿಲ್ಲ') },
  'sync.refused': {
    en: '{count} not accepted by the office. Call your supervisor.',
    te: d('{count} ఆఫీస్ అంగీకరించలేదు. సూపర్‌వైజర్‌కు కాల్ చేయండి.'),
    kn: d('{count} ಆಫೀಸ್ ಸ್ವೀಕರಿಸಲಿಲ್ಲ. ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ.'),
  },
  'sync.offline': {
    en: 'No internet. Work is saved on the phone and sent later.',
    te: d('ఇంటర్నెట్ లేదు. పని ఫోన్‌లో సేవ్ అవుతుంది, తర్వాత పంపబడుతుంది.'),
    kn: d('ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ. ಕೆಲಸ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಯುತ್ತದೆ, ನಂತರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.'),
  },

  // Camera
  'camera.pole': { en: 'Stand back. Fit the whole pole in the frame.', te: d('దూరంగా నిలబడండి. పోల్ మొత్తం ఫ్రేమ్‌లో రావాలి.'), kn: d('ದೂರ ನಿಲ್ಲಿ. ಇಡೀ ಕಂಬ ಚೌಕಟ್ಟಿನಲ್ಲಿ ಬರಲಿ.') },
  'camera.box': { en: 'Fit the whole box in the frame.', te: d('బాక్స్ మొత్తం ఫ్రేమ్‌లో రావాలి.'), kn: d('ಇಡೀ ಬಾಕ್ಸ್ ಚೌಕಟ್ಟಿನಲ್ಲಿ ಬರಲಿ.') },
  'camera.drop': { en: 'Photo of the wire where it reaches the house.', te: d('ఇంటికి వైర్ చేరే చోటు ఫోటో తీయండి.'), kn: d('ಮನೆಗೆ ವೈರ್ ಬರುವ ಜಾಗದ ಫೋಟೋ ತೆಗೆಯಿರಿ.') },
  'camera.meter': { en: 'Photo of the meter screen. The numbers must be clear.', te: d('మీటర్ స్క్రీన్ ఫోటో తీయండి. అంకెలు స్పష్టంగా కనిపించాలి.'), kn: d('ಮೀಟರ್ ಪರದೆಯ ಫೋಟೋ ತೆಗೆಯಿರಿ. ಅಂಕೆಗಳು ಸ್ಪಷ್ಟವಾಗಿ ಕಾಣಬೇಕು.') },
  'camera.danger': { en: 'Stay back. Take the photo from where you are.', te: d('దూరంగానే ఉండండి. మీరు ఉన్న చోటు నుండే ఫోటో తీయండి.'), kn: d('ದೂರದಲ್ಲೇ ಇರಿ. ನೀವು ಇರುವ ಜಾಗದಿಂದಲೇ ಫೋಟೋ ತೆಗೆಯಿರಿ.') },
  'camera.take': { en: 'Take photo', te: d('ఫోటో తీయండి'), kn: d('ಫೋಟೋ ತೆಗೆಯಿರಿ') },
  'camera.open': { en: 'Open camera', te: d('కెమెరా తెరవండి'), kn: d('ಕ್ಯಾಮೆರಾ ತೆರೆಯಿರಿ') },
  'camera.starting': { en: 'Starting camera', te: d('కెమెరా మొదలవుతోంది'), kn: d('ಕ್ಯಾಮೆರಾ ಆರಂಭವಾಗುತ್ತಿದೆ') },
  'camera.blocked': { en: 'Camera is blocked for this app.', te: d('ఈ యాప్‌కు కెమెరా అనుమతి లేదు.'), kn: d('ಈ ಆ್ಯಪ್‌ಗೆ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಇಲ್ಲ.') },
  'camera.saving': { en: 'Saving photo', te: d('ఫోటో సేవ్ అవుతోంది'), kn: d('ಫೋಟೋ ಉಳಿಸಲಾಗುತ್ತಿದೆ') },
  'camera.retake': { en: 'Photo again', te: d('మళ్ళీ ఫోటో'), kn: d('ಮತ್ತೆ ಫೋಟೋ') },

  // GPS
  'gps.searching': { en: 'Finding your place. Wait for the green tick.', te: d('మీ స్థలం వెతుకుతోంది. ఆకుపచ్చ టిక్ కోసం ఆగండి.'), kn: d('ನಿಮ್ಮ ಸ್ಥಳ ಹುಡುಕುತ್ತಿದೆ. ಹಸಿರು ಟಿಕ್‌ಗಾಗಿ ಕಾಯಿರಿ.') },
  'gps.good': { en: 'Place found', te: d('స్థలం దొరికింది'), kn: d('ಸ್ಥಳ ಸಿಕ್ಕಿದೆ') },
  'gps.rough': { en: 'Place found roughly. The office will check it.', te: d('స్థలం సుమారుగా దొరికింది. ఆఫీస్ సరిచూస్తుంది.'), kn: d('ಸ್ಥಳ ಅಂದಾಜಾಗಿ ಸಿಕ್ಕಿದೆ. ಆಫೀಸ್ ಪರಿಶೀಲಿಸುತ್ತದೆ.') },
  'gps.openSky': { en: 'Go to open sky. Wait for the green tick.', te: d('ఆకాశం కనిపించే చోటుకు వెళ్ళండి. ఆకుపచ్చ టిక్ కోసం ఆగండి.'), kn: d('ತೆರೆದ ಆಕಾಶ ಇರುವ ಕಡೆ ಹೋಗಿ. ಹಸಿರು ಟಿಕ್‌ಗಾಗಿ ಕಾಯಿರಿ.') },
  'gps.officePlace': { en: 'Save without place. Office will place it.', te: d('స్థలం లేకుండా సేవ్ చేయండి. ఆఫీస్ పెడుతుంది.'), kn: d('ಸ್ಥಳ ಇಲ್ಲದೆ ಉಳಿಸಿ. ಆಫೀಸ್ ಇಡುತ್ತದೆ.') },
  'gps.blocked': { en: 'Location is blocked for this app.', te: d('ఈ యాప్‌కు లొకేషన్ అనుమతి లేదు.'), kn: d('ಈ ಆ್ಯಪ್‌ಗೆ ಲೊಕೇಶನ್ ಅನುಮತಿ ಇಲ್ಲ.') },
  'gps.unavailable': { en: 'This phone gives no location here.', te: d('ఈ ఫోన్ ఇక్కడ లొకేషన్ ఇవ్వడం లేదు.'), kn: d('ಈ ಫೋನ್ ಇಲ್ಲಿ ಲೊಕೇಶನ್ ಕೊಡುತ್ತಿಲ್ಲ.') },
  'gps.howToAllow': { en: 'How to allow', te: d('అనుమతి ఎలా ఇవ్వాలి'), kn: d('ಅನುಮತಿ ಹೇಗೆ ಕೊಡುವುದು') },

  // Same one nearby
  'same.title': {
    en: '{kind, select, pole {Is it the same pole?} box {Is it the same box?} other {Is it the same house?}}',
    te: d('{kind, select, pole {ఇదే పోల్ ఆ?} box {ఇదే బాక్స్ ఆ?} other {ఇదే ఇల్లు ఆ?}}'),
    kn: d('{kind, select, pole {ಇದೇ ಕಂಬವೇ?} box {ಇದೇ ಬಾಕ್ಸೇ?} other {ಇದೇ ಮನೆಯೇ?}}'),
  },
  'same.yes': { en: 'Same: {name}', te: d('ఇదే: {name}'), kn: d('ಇದೇ: {name}') },
  'same.new': { en: 'No, a new one', te: d('కాదు, కొత్తది'), kn: d('ಇಲ್ಲ, ಹೊಸದು') },
  'same.noPhoto': { en: 'No photo', te: d('ఫోటో లేదు'), kn: d('ಫೋಟೋ ಇಲ್ಲ') },
  'already.title': { en: 'Already on the map', te: d('ఇది ఇప్పటికే మ్యాప్‌లో ఉంది'), kn: d('ಇದು ಈಗಾಗಲೇ ನಕ್ಷೆಯಲ್ಲಿದೆ') },
  'already.body': {
    en: 'Nothing new was added. The next one will come after {name}.',
    te: d('కొత్తగా ఏమీ జోడించలేదు. తర్వాతది {name} తర్వాత వస్తుంది.'),
    kn: d('ಹೊಸದಾಗಿ ಏನೂ ಸೇರಿಸಿಲ್ಲ. ಮುಂದಿನದು {name} ನಂತರ ಬರುತ್ತದೆ.'),
  },

  // Tag
  'tag.title': { en: 'Point the camera at the tag', te: d('కెమెరాను ట్యాగ్ వైపు చూపండి'), kn: d('ಕ್ಯಾಮೆರಾವನ್ನು ಟ್ಯಾಗ್ ಕಡೆ ತೋರಿಸಿ') },
  'tag.none': { en: 'No tag', te: d('ట్యాగ్ లేదు'), kn: d('ಟ್ಯಾಗ್ ಇಲ್ಲ') },
  'tag.read': { en: 'Tag read', te: d('ట్యాగ్ చదివింది'), kn: d('ಟ್ಯಾಗ್ ಓದಲಾಗಿದೆ') },
  'tag.known': { en: 'This tag is already saved: {name}', te: d('ఈ ట్యాగ్ ఇప్పటికే సేవ్ అయింది: {name}'), kn: d('ಈ ಟ್ಯಾಗ್ ಈಗಾಗಲೇ ಉಳಿಸಲಾಗಿದೆ: {name}') },
  'tag.loading': { en: 'Starting scanner', te: d('స్కానర్ మొదలవుతోంది'), kn: d('ಸ್ಕ್ಯಾನರ್ ಆರಂಭವಾಗುತ್ತಿದೆ') },
  'tag.failed': { en: 'The scanner did not start. Tap No tag.', te: d('స్కానర్ మొదలుకాలేదు. ట్యాగ్ లేదు నొక్కండి.'), kn: d('ಸ್ಕ್ಯಾನರ್ ಆರಂಭವಾಗಲಿಲ್ಲ. ಟ್ಯಾಗ್ ಇಲ್ಲ ಒತ್ತಿರಿ.') },

  // Picture questions
  'q.owner': { en: 'Whose pole is it?', te: d('ఇది ఎవరి పోల్?'), kn: d('ಇದು ಯಾರ ಕಂಬ?') },
  'q.owner.telecom': { en: 'Cable pole', te: d('కేబుల్ పోల్'), kn: d('ಕೇಬಲ್ ಕಂಬ') },
  'q.owner.electricity': { en: 'Electric pole', te: d('కరెంట్ పోల్'), kn: d('ಕರೆಂಟ್ ಕಂಬ') },
  'q.material': { en: 'What is the pole made of?', te: d('పోల్ దేనితో చేశారు?'), kn: d('ಕಂಬ ಯಾವುದರಿಂದ ಮಾಡಿದ್ದು?') },
  'q.material.concrete': { en: 'Cement', te: d('సిమెంట్'), kn: d('ಸಿಮೆಂಟ್') },
  'q.material.iron': { en: 'Iron', te: d('ఇనుము'), kn: d('ಕಬ್ಬಿಣ') },
  'q.material.wood': { en: 'Wood', te: d('చెక్క'), kn: d('ಮರ') },
  'q.box': { en: 'What kind of box?', te: d('ఏ రకమైన బాక్స్?'), kn: d('ಯಾವ ರೀತಿಯ ಬಾಕ್ಸ್?') },
  'q.box.street_box': { en: 'Street box', te: d('వీధి బాక్స్'), kn: d('ಬೀದಿ ಬಾಕ್ಸ್') },
  'q.box.joint_box': { en: 'Joint box', te: d('జాయింట్ బాక్స్'), kn: d('ಜಾಯಿಂಟ್ ಬಾಕ್ಸ್') },
  'choice.unknown': { en: "Don't know", te: d('తెలియదు'), kn: d('ಗೊತ್ತಿಲ್ಲ') },

  // Customer
  'customer.title': { en: 'Which customer?', te: d('ఏ కస్టమర్?'), kn: d('ಯಾವ ಗ್ರಾಹಕರು?') },
  'customer.search': { en: 'Search name or phone number', te: d('పేరు లేదా ఫోన్ నంబర్ వెతకండి'), kn: d('ಹೆಸರು ಅಥವಾ ಫೋನ್ ನಂಬರ್ ಹುಡುಕಿ') },
  'customer.notListed': { en: 'Not in the list', te: d('జాబితాలో లేరు'), kn: d('ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ') },
  'customer.none': { en: 'No customer found. Search by name.', te: d('కస్టమర్ దొరకలేదు. పేరుతో వెతకండి.'), kn: d('ಗ್ರಾಹಕರು ಸಿಗಲಿಲ್ಲ. ಹೆಸರಿನಿಂದ ಹುಡುಕಿ.') },
  'customer.distance': { en: '{meters} m away', te: d('{meters} మీ. దూరం'), kn: d('{meters} ಮೀ. ದೂರ') },

  // Summary
  'summary.title': { en: 'Check, then save', te: d('చూసి, సేవ్ చేయండి'), kn: d('ನೋಡಿ, ನಂತರ ಉಳಿಸಿ') },
  'summary.save': { en: 'Save', te: d('సేవ్ చేయండి'), kn: d('ಉಳಿಸಿ') },
  'summary.fix': { en: 'Fix', te: d('సరిచేయండి'), kn: d('ಸರಿಪಡಿಸಿ') },
  'summary.officePlace': { en: 'Office must place this', te: d('దీన్ని ఆఫీస్ మ్యాప్‌లో పెట్టాలి'), kn: d('ಇದನ್ನು ಆಫೀಸ್ ನಕ್ಷೆಯಲ್ಲಿ ಇಡಬೇಕು') },
  'summary.tag': { en: 'Tag: {tag}', te: d('ట్యాగ్: {tag}'), kn: d('ಟ್ಯಾಗ್: {tag}') },
  'summary.after': { en: 'Comes after {name}', te: d('{name} తర్వాత'), kn: d('{name} ನಂತರ') },
  'summary.customer': { en: 'For {name}', te: d('{name} కోసం'), kn: d('{name} ಅವರಿಗಾಗಿ') },
  'summary.saving': { en: 'Saving', te: d('సేవ్ అవుతోంది'), kn: d('ಉಳಿಸಲಾಗುತ್ತಿದೆ') },
  'fix.title': { en: 'What do you want to fix?', te: d('ఏమి సరిచేయాలి?'), kn: d('ಏನು ಸರಿಪಡಿಸಬೇಕು?') },
  'fix.tag': { en: 'Tag again', te: d('మళ్ళీ ట్యాగ్'), kn: d('ಮತ್ತೆ ಟ್ಯಾಗ್') },
  'fix.answers': { en: 'Answers again', te: d('మళ్ళీ జవాబులు'), kn: d('ಮತ್ತೆ ಉತ್ತರಗಳು') },
  'fix.customer': { en: 'Customer again', te: d('మళ్ళీ కస్టమర్'), kn: d('ಮತ್ತೆ ಗ್ರಾಹಕರು') },
  'fix.number': { en: 'Number again', te: d('మళ్ళీ అంకె'), kn: d('ಮತ್ತೆ ಅಂಕೆ') },
  'fix.discard': { en: 'Delete this, do not save', te: d('దీన్ని తొలగించండి, సేవ్ చేయవద్దు'), kn: d('ಇದನ್ನು ಅಳಿಸಿ, ಉಳಿಸಬೇಡಿ') },
  'fix.discardAsk': { en: 'Delete this photo and answers?', te: d('ఈ ఫోటో, జవాబులు తొలగించాలా?'), kn: d('ಈ ಫೋಟೋ ಮತ್ತು ಉತ್ತರಗಳನ್ನು ಅಳಿಸಬೇಕೆ?') },
  'fix.keep': { en: 'Keep it', te: d('ఉంచండి'), kn: d('ಇಟ್ಟುಕೊಳ್ಳಿ') },
  'map.offline': {
    en: 'The map picture needs internet. Your work is still saved on the phone.',
    te: d('మ్యాప్ బొమ్మకు ఇంటర్నెట్ కావాలి. మీ పని ఫోన్‌లో సేవ్ అవుతుంది.'),
    kn: d('ನಕ್ಷೆ ಚಿತ್ರಕ್ಕೆ ಇಂಟರ್ನೆಟ್ ಬೇಕು. ನಿಮ್ಮ ಕೆಲಸ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಯುತ್ತದೆ.'),
  },

  // After saving
  'saved.title': { en: 'Saved on phone', te: d('ఫోన్‌లో సేవ్ అయింది'), kn: d('ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ') },
  'saved.next': {
    en: '{kind, select, pole {Next pole} box {Next box} drop {Next house} light {Next reading} other {Report another}}',
    te: d('{kind, select, pole {తర్వాత పోల్} box {తర్వాత బాక్స్} drop {తర్వాత ఇల్లు} light {తర్వాత రీడింగ్} other {ఇంకొకటి తెలియజేయండి}}'),
    kn: d('{kind, select, pole {ಮುಂದಿನ ಕಂಬ} box {ಮುಂದಿನ ಬಾಕ್ಸ್} drop {ಮುಂದಿನ ಮನೆ} light {ಮುಂದಿನ ರೀಡಿಂಗ್} other {ಇನ್ನೊಂದು ತಿಳಿಸಿ}}'),
  },
  'saved.undo': { en: 'Undo', te: d('రద్దు చేయండి'), kn: d('ರದ್ದು ಮಾಡಿ') },
  'saved.finished': { en: 'Finished', te: d('అయిపోయింది'), kn: d('ಮುಗಿಯಿತು') },
  'saved.undone': { en: 'Removed. Nothing else changed.', te: d('తొలగించబడింది. ఇంకేమీ మారలేదు.'), kn: d('ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಬೇರೆ ಏನೂ ಬದಲಾಗಿಲ್ಲ.') },
  'saved.undoHint': { en: 'Made a mistake? Tap Undo.', te: d('తప్పు జరిగిందా? రద్దు చేయండి నొక్కండి.'), kn: d('ತಪ್ಪಾಯಿತೇ? ರದ್ದು ಮಾಡಿ ಒತ್ತಿರಿ.') },
  'saved.failed': {
    en: 'Not saved on phone. Tap Try again. If it fails again, call your supervisor.',
    te: d('ఫోన్‌లో సేవ్ కాలేదు. మళ్ళీ ప్రయత్నించండి నొక్కండి. మళ్ళీ విఫలమైతే సూపర్‌వైజర్‌కు కాల్ చేయండి.'),
    kn: d('ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಒತ್ತಿರಿ. ಮತ್ತೆ ವಿಫಲವಾದರೆ ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ.'),
  },

  // dBm pad
  'pad.title': { en: 'Type the numbers on the meter', te: d('మీటర్‌పై ఉన్న అంకెలు టైప్ చేయండి'), kn: d('ಮೀಟರ್‌ನಲ್ಲಿರುವ ಅಂಕೆಗಳನ್ನು ಒತ್ತಿರಿ') },
  'pad.hint': { en: 'Skip the minus sign and the dot.', te: d('మైనస్, చుక్క అవసరం లేదు.'), kn: d('ಮೈನಸ್ ಮತ್ತು ಚುಕ್ಕೆ ಬೇಡ.') },
  'pad.delete': { en: 'Delete', te: d('తొలగించు'), kn: d('ಅಳಿಸು') },
  'pad.clear': { en: 'Clear', te: d('అన్నీ తొలగించు'), kn: d('ಎಲ್ಲಾ ಅಳಿಸು') },
  'pad.ok': { en: 'Good light', te: d('లైట్ బాగుంది'), kn: d('ಲೈಟ್ ಚೆನ್ನಾಗಿದೆ') },
  'pad.low_margin': { en: 'Weak light. Save it. The office will look.', te: d('లైట్ తక్కువగా ఉంది. సేవ్ చేయండి. ఆఫీస్ చూస్తుంది.'), kn: d('ಲೈಟ್ ಕಡಿಮೆ ಇದೆ. ಉಳಿಸಿ. ಆಫೀಸ್ ನೋಡುತ್ತದೆ.') },
  'pad.too_weak': { en: 'Very weak light. Check the number, then save.', te: d('లైట్ చాలా తక్కువ. అంకె సరిచూసి సేవ్ చేయండి.'), kn: d('ಲೈಟ್ ತುಂಬಾ ಕಡಿಮೆ. ಅಂಕೆ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಉಳಿಸಿ.') },
  'pad.too_much_light': { en: 'Too much light. Check the number, then save.', te: d('లైట్ ఎక్కువగా ఉంది. అంకె సరిచూసి సేవ్ చేయండి.'), kn: d('ಲೈಟ್ ಹೆಚ್ಚಾಗಿದೆ. ಅಂಕೆ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಉಳಿಸಿ.') },
  'pad.check_number': { en: 'Check the number on the meter.', te: d('మీటర్‌పై అంకె సరిచూడండి.'), kn: d('ಮೀಟರ್‌ನಲ್ಲಿರುವ ಅಂಕೆ ಪರಿಶೀಲಿಸಿ.') },
  'pad.empty': { en: 'Type the numbers first.', te: d('ముందు అంకెలు టైప్ చేయండి.'), kn: d('ಮೊದಲು ಅಂಕೆಗಳನ್ನು ಒತ್ತಿರಿ.') },

  // Danger and safety (safety wording is itself a draft awaiting a safety reviewer)
  'danger.rulesTitle': { en: 'Stay safe', te: d('జాగ్రత్తగా ఉండండి'), kn: d('ಸುರಕ್ಷಿತವಾಗಿರಿ') },
  'danger.saved': { en: 'Danger reported. Stay away and keep others away.', te: d('ప్రమాదం తెలియజేయబడింది. దూరంగా ఉండండి, ఇతరులను దూరంగా ఉంచండి.'), kn: d('ಅಪಾಯ ತಿಳಿಸಲಾಗಿದೆ. ದೂರವಿರಿ, ಇತರರನ್ನೂ ದೂರವಿಡಿ.') },
  'safety.noClimb': { en: 'Mapping never needs climbing or touching a pole.', te: d('మ్యాపింగ్‌కు పోల్ ఎక్కడం లేదా తాకడం ఎప్పుడూ అవసరం లేదు.'), kn: d('ಮ್ಯಾಪಿಂಗ್‌ಗೆ ಕಂಬ ಹತ್ತುವುದು ಅಥವಾ ಮುಟ್ಟುವುದು ಎಂದಿಗೂ ಬೇಕಿಲ್ಲ.') },
  'safety.live': { en: 'Treat every wire, stay and metal pole as live.', te: d('ప్రతి వైర్, స్టే వైర్, ఇనుప పోల్‌లో కరెంట్ ఉందని భావించండి.'), kn: d('ಪ್ರತಿ ವೈರ್, ಸ್ಟೇ ವೈರ್ ಮತ್ತು ಕಬ್ಬಿಣದ ಕಂಬದಲ್ಲಿ ಕರೆಂಟ್ ಇದೆ ಎಂದು ತಿಳಿಯಿರಿ.') },
  'safety.rain': { en: 'Do not survey poles in rain or lightning.', te: d('వర్షం లేదా పిడుగుల సమయంలో పోల్స్ సర్వే చేయవద్దు.'), kn: d('ಮಳೆ ಅಥವಾ ಸಿಡಿಲಿನ ಸಮಯದಲ್ಲಿ ಕಂಬಗಳ ಸರ್ವೇ ಮಾಡಬೇಡಿ.') },
  'safety.rods': { en: 'Do not raise rods or ladders near wires.', te: d('వైర్ల దగ్గర కర్రలు లేదా నిచ్చెనలు ఎత్తవద్దు.'), kn: d('ವೈರ್‌ಗಳ ಹತ್ತಿರ ಕೋಲು ಅಥವಾ ಏಣಿ ಎತ್ತಬೇಡಿ.') },
  'safety.report': {
    en: 'Report a leaning, sparking or burning pole to the electricity office.',
    te: d('వంగిన, మెరుపులు వచ్చే లేదా కాలుతున్న పోల్ గురించి కరెంట్ ఆఫీస్‌కు చెప్పండి.'),
    kn: d('ಬಾಗಿದ, ಕಿಡಿ ಬರುವ ಅಥವಾ ಉರಿಯುತ್ತಿರುವ ಕಂಬದ ಬಗ್ಗೆ ಕರೆಂಟ್ ಆಫೀಸ್‌ಗೆ ತಿಳಿಸಿ.'),
  },
  'safety.traffic': { en: 'Do not stand in traffic for a photo.', te: d('ఫోటో కోసం ట్రాఫిక్‌లో నిలబడవద్దు.'), kn: d('ಫೋಟೋಗಾಗಿ ಟ್ರಾಫಿಕ್‌ನಲ್ಲಿ ನಿಲ್ಲಬೇಡಿ.') },
  'safety.riding': { en: 'Do not use the phone while riding.', te: d('బండి నడుపుతూ ఫోన్ వాడవద్దు.'), kn: d('ಗಾಡಿ ಓಡಿಸುವಾಗ ಫೋನ್ ಬಳಸಬೇಡಿ.') },
  'safety.draft': {
    en: 'Draft safety words. A safety officer has not checked them yet.',
    te: d('ఇవి ముసాయిదా భద్రతా మాటలు. భద్రతా అధికారి ఇంకా సరిచూడలేదు.'),
    kn: d('ಇವು ಕರಡು ಸುರಕ್ಷತಾ ಮಾತುಗಳು. ಸುರಕ್ಷತಾ ಅಧಿಕಾರಿ ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ.'),
  },

  // First run help
  'help.title': { en: 'Before you start', te: d('మొదలుపెట్టే ముందు'), kn: d('ಆರಂಭಿಸುವ ಮೊದಲು') },
  'help.camera': { en: 'The phone will ask to use the camera. Tap Allow.', te: d('ఫోన్ కెమెరా అనుమతి అడుగుతుంది. Allow నొక్కండి.'), kn: d('ಫೋನ್ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಕೇಳುತ್ತದೆ. Allow ಒತ್ತಿರಿ.') },
  'help.location': { en: 'The phone will ask for your location. Tap Allow.', te: d('ఫోన్ లొకేషన్ అనుమతి అడుగుతుంది. Allow నొక్కండి.'), kn: d('ಫೋನ್ ಲೊಕೇಶನ್ ಅನುಮತಿ ಕೇಳುತ್ತದೆ. Allow ಒತ್ತಿರಿ.') },
  'help.denied': {
    en: 'Tapped Block by mistake? Tap the lock next to the web address, then Permissions, then Allow.',
    te: d('పొరపాటున Block నొక్కారా? వెబ్ అడ్రస్ పక్కన తాళం గుర్తు నొక్కండి, తర్వాత Permissions, తర్వాత Allow.'),
    kn: d('ತಪ್ಪಾಗಿ Block ಒತ್ತಿದಿರಾ? ವೆಬ್ ವಿಳಾಸದ ಪಕ್ಕದ ಬೀಗದ ಗುರುತು ಒತ್ತಿ, ನಂತರ Permissions, ನಂತರ Allow.'),
  },
  'help.undo': { en: 'Every save can be undone.', te: d('ప్రతి సేవ్‌ను రద్దు చేయవచ్చు.'), kn: d('ಪ್ರತಿ ಉಳಿಕೆಯನ್ನು ರದ್ದು ಮಾಡಬಹುದು.') },
  'help.start': { en: 'Start', te: d('మొదలుపెట్టండి'), kn: d('ಆರಂಭಿಸಿ') },
  'help.insecure': {
    en: 'This address is not secure (no https). Camera and location will not work. Tell the office.',
    te: d('ఈ అడ్రస్ సురక్షితం కాదు (https లేదు). కెమెరా, లొకేషన్ పనిచేయవు. ఆఫీస్‌కు చెప్పండి.'),
    kn: d('ಈ ವಿಳಾಸ ಸುರಕ್ಷಿತವಲ್ಲ (https ಇಲ್ಲ). ಕ್ಯಾಮೆರಾ ಮತ್ತು ಲೊಕೇಶನ್ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. ಆಫೀಸ್‌ಗೆ ತಿಳಿಸಿ.'),
  },

  // Language
  'lang.title': { en: 'Choose language', te: d('భాష ఎంచుకోండి'), kn: d('ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ') },
  'lang.draft': { en: 'Draft words, being checked', te: d('ముసాయిదా మాటలు, సరిచూస్తున్నారు'), kn: d('ಕರಡು ಮಾತುಗಳು, ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ') },

  // Common
  'common.back': { en: 'Back', te: d('వెనుకకు'), kn: d('ಹಿಂದೆ') },
  'common.home': { en: 'Home', te: d('హోమ్'), kn: d('ಮುಖಪುಟ') },
  'common.tryAgain': { en: 'Try again', te: d('మళ్ళీ ప్రయత్నించండి'), kn: d('ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ') },
  'common.listen': { en: 'Listen', te: d('వినండి'), kn: d('ಕೇಳಿ') },
  'storage.failed': {
    en: 'Phone storage is not working. Work cannot be saved. Call your supervisor.',
    te: d('ఫోన్ స్టోరేజ్ పనిచేయడం లేదు. పని సేవ్ కాదు. సూపర్‌వైజర్‌కు కాల్ చేయండి.'),
    kn: d('ಫೋನ್ ಸ್ಟೋರೇಜ್ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ. ಕೆಲಸ ಉಳಿಯುವುದಿಲ್ಲ. ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ.'),
  },
} satisfies Catalog;

export type MessageKey = keyof typeof MESSAGES;

/** Terms to test with crews before any wording is final: each pair is "loanword vs native word". */
export const TERMS_TO_TEST = [
  { en: 'pole', te: 'పోల్ / స్తంభం', kn: 'ಕಂಬ / ಪೋಲ್' },
  { en: 'box', te: 'బాక్స్ / పెట్టె', kn: 'ಬಾಕ್ಸ್ / ಪೆಟ್ಟಿಗೆ' },
  { en: 'save', te: 'సేవ్ చేయండి / భద్రపరచండి', kn: 'ಉಳಿಸಿ / ಸೇವ್ ಮಾಡಿ' },
  { en: 'office', te: 'ఆఫీస్ / కార్యాలయం', kn: 'ಆಫೀಸ್ / ಕಚೇರಿ' },
  { en: 'light level', te: 'లైట్ లెవెల్ / వెలుతురు స్థాయి / సిగ్నల్', kn: 'ಲೈಟ್ ಲೆವೆಲ್ / ಬೆಳಕಿನ ಮಟ್ಟ / ಸಿಗ್ನಲ್' },
  { en: 'electric pole', te: 'కరెంట్ పోల్ / విద్యుత్ స్తంభం', kn: 'ಕರೆಂಟ್ ಕಂಬ / ವಿದ್ಯುತ್ ಕಂಬ' },
  { en: 'cement', te: 'సిమెంట్ / కాంక్రీట్', kn: 'ಸಿಮೆಂಟ್ / ಕಾಂಕ್ರೀಟ್' },
  { en: 'tag', te: 'ట్యాగ్ / గుర్తు బిళ్ళ', kn: 'ಟ್ಯಾಗ್ / ಗುರುತು ಚೀಟಿ' },
  { en: 'house wire (drop)', te: 'ఇంటి వైర్ / డ్రాప్ వైర్', kn: 'ಮನೆ ವೈರ್ / ಡ್ರಾಪ್ ವೈರ್' },
  { en: 'undo', te: 'రద్దు చేయండి / వెనక్కి తీసుకోండి', kn: 'ರದ್ದು ಮಾಡಿ / ವಾಪಸ್ ತೆಗೆದುಕೊಳ್ಳಿ' },
  { en: 'supervisor', te: 'సూపర్‌వైజర్ / పర్యవేక్షకుడు', kn: 'ಸೂಪರ್‌ವೈಸರ್ / ಮೇಲ್ವಿಚಾರಕ' },
  { en: 'location / place', te: 'లొకేషన్ / స్థలం', kn: 'ಲೊಕೇಶನ್ / ಸ್ಥಳ' },
] as const;
