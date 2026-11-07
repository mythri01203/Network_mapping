# Telugu and Kannada wording: review needed

**Status: every Telugu and Kannada text in the field capture flow is a DRAFT.** It was written without a native speaker or a field crew. Each string is marked `reviewed: false` in `apps/web/src/i18n/messages.ts`, and nothing on screen says it has been checked. The language picker labels both languages "Draft words, being checked".

Engineer screens are English only. Only the phone capture flow (`/capture`) is translated.

## What needs the owner

1. Confirm where your crews work (decision 2 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)). Telangana wording may not suit coastal Andhra, and Bengaluru Kannada may differ from North Karnataka.
2. Find one native speaker per language who also knows the trade, and 3 to 5 crew members per region.
3. Have the safety lines (`safety.*`) checked by a qualified safety person in English first, and translate only after that (decision 6).

## How to review

Do not just ask "is this right?": people agree with whoever wrote it. Instead:

1. **Recognition test.** Show each term in "Terms to test" below, without the English, and ask what it means. Record which option people understand fastest, and use the winner everywhere.
2. **Read-aloud test.** Have a crew member read each screen aloud. Mark any word they hesitate on, misread, or replace with their own.
3. **Task test.** On a phone, give a picture card ("add this pole") and watch. Wrong taps point at wrong words.
4. Note the regional variant where it differs, for example Telangana and coastal Andhra Telugu.
5. Edit the text in `apps/web/src/i18n/messages.ts`, then change that key's `reviewed` to `true`. One key at a time, only after the checks above, never in bulk.
6. Only then record audio. A recording of a draft is never played: the app checks `reviewed` before it shows a speaker button.

Rules from `fibergis-easy-field-ux`: say what it is, not its engineering name; write loanwords in local script; keep Western digits; never join sentence pieces. Each line is one whole message, and `{name}`-style placeholders must stay exactly as they are. English inside the Telugu and Kannada lines ("Allow", "Block", "Permissions") is deliberate: it is what the browser shows.

## Audio clips

No clips are recorded. To add one: record a human voice reading the final, reviewed text; save it as `apps/web/public/audio/<lang>/<key>.mp3` (for example `audio/te/home.addPole.mp3`); and add the key to that language's list in `apps/web/public/audio/manifest.json`. The speaker button then appears beside that text, and the service worker stores the clip for offline use. Browser speech (`speechSynthesis`) is never used.

## Terms to test

Each row is a loanword against a native word, or two candidates. Test them before fixing any wording.

| English | Telugu options | Kannada options |
|---|---|---|
| pole | పోల్ / స్తంభం | ಕಂಬ / ಪೋಲ್ |
| box | బాక్స్ / పెట్టె | ಬಾಕ್ಸ್ / ಪೆಟ್ಟಿಗೆ |
| save | సేవ్ చేయండి / భద్రపరచండి | ಉಳಿಸಿ / ಸೇವ್ ಮಾಡಿ |
| office | ఆఫీస్ / కార్యాలయం | ಆಫೀಸ್ / ಕಚೇರಿ |
| light level | లైట్ లెవెల్ / వెలుతురు స్థాయి / సిగ్నల్ | ಲೈಟ್ ಲೆವೆಲ್ / ಬೆಳಕಿನ ಮಟ್ಟ / ಸಿಗ್ನಲ್ |
| electric pole | కరెంట్ పోల్ / విద్యుత్ స్తంభం | ಕರೆಂಟ್ ಕಂಬ / ವಿದ್ಯುತ್ ಕಂಬ |
| cement | సిమెంట్ / కాంక్రీట్ | ಸಿಮೆಂಟ್ / ಕಾಂಕ್ರೀಟ್ |
| tag | ట్యాగ్ / గుర్తు బిళ్ళ | ಟ್ಯಾಗ್ / ಗುರುತು ಚೀಟಿ |
| house wire (drop) | ఇంటి వైర్ / డ్రాప్ వైర్ | ಮನೆ ವೈರ್ / ಡ್ರಾಪ್ ವೈರ್ |
| undo | రద్దు చేయండి / వెనక్కి తీసుకోండి | ರದ್ದು ಮಾಡಿ / ವಾಪಸ್ ತೆಗೆದುಕೊಳ್ಳಿ |
| supervisor | సూపర్‌వైజర్ / పర్యవేక్షకుడు | ಸೂಪರ್‌ವೈಸರ್ / ಮೇಲ್ವಿಚಾರಕ |
| location / place | లొకేషన్ / స్థలం | ಲೊಕೇಶನ್ / ಸ್ಥಳ |

## Every draft string

| Key | English (source) | Telugu draft | Kannada draft |
|---|---|---|---|
| `home.title` | Field capture | ఫీల్డ్ పని | ಫೀಲ್ಡ್ ಕೆಲಸ |
| `home.addPole` | Add pole | పోల్ జోడించండి | ಕಂಬ ಸೇರಿಸಿ |
| `home.addBox` | Add box | బాక్స్ జోడించండి | ಬಾಕ್ಸ್ ಸೇರಿಸಿ |
| `home.addDrop` | Add customer drop | కస్టమర్ ఇంటి వైర్ జోడించండి | ಗ್ರಾಹಕರ ಮನೆ ವೈರ್ ಸೇರಿಸಿ |
| `home.lightLevel` | Record light level | లైట్ లెవెల్ నమోదు చేయండి | ಲೈಟ್ ಲೆವೆಲ್ ದಾಖಲಿಸಿ |
| `home.danger` | Report danger | ప్రమాదం తెలియజేయండి | ಅಪಾಯ ತಿಳಿಸಿ |
| `home.callSupervisor` | Call supervisor | సూపర్‌వైజర్‌కు కాల్ చేయండి | ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ |
| `home.help` | Help | సహాయం | ಸಹಾಯ |
| `home.language` | Language | భాష | ಭಾಷೆ |
| `home.officeMap` | Office map | ఆఫీస్ మ్యాప్ | ಆಫೀಸ್ ನಕ್ಷೆ |
| `home.continue` | Continue the unfinished one | ఆపినదాన్ని కొనసాగించండి | ಅರ್ಧ ಮಾಡಿದ್ದನ್ನು ಮುಂದುವರಿಸಿ |
| `home.resumed` | Continuing where you stopped. | మీరు ఆపిన చోట నుండి కొనసాగుతోంది. | ನೀವು ನಿಲ್ಲಿಸಿದ ಕಡೆಯಿಂದ ಮುಂದುವರಿಯುತ್ತಿದೆ. |
| `sync.saved` | Saved on phone {count} | ఫోన్‌లో సేవ్ అయింది {count} | ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ {count} |
| `sync.sending` | Sending | పంపుతోంది | ಕಳುಹಿಸುತ್ತಿದೆ |
| `sync.sent` | Sent to office | ఆఫీస్‌కు పంపబడింది | ಆಫೀಸ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ |
| `sync.notSaved` | Not saved on phone | ఫోన్‌లో సేవ్ కాలేదు | ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿಲ್ಲ |
| `sync.refused` | {count} not accepted by the office. Call your supervisor. | {count} ఆఫీస్ అంగీకరించలేదు. సూపర్‌వైజర్‌కు కాల్ చేయండి. | {count} ಆಫೀಸ್ ಸ್ವೀಕರಿಸಲಿಲ್ಲ. ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ. |
| `sync.offline` | No internet. Work is saved on the phone and sent later. | ఇంటర్నెట్ లేదు. పని ఫోన్‌లో సేవ్ అవుతుంది, తర్వాత పంపబడుతుంది. | ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ. ಕೆಲಸ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಯುತ್ತದೆ, ನಂತರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. |
| `camera.pole` | Stand back. Fit the whole pole in the frame. | దూరంగా నిలబడండి. పోల్ మొత్తం ఫ్రేమ్‌లో రావాలి. | ದೂರ ನಿಲ್ಲಿ. ಇಡೀ ಕಂಬ ಚೌಕಟ್ಟಿನಲ್ಲಿ ಬರಲಿ. |
| `camera.box` | Fit the whole box in the frame. | బాక్స్ మొత్తం ఫ్రేమ్‌లో రావాలి. | ಇಡೀ ಬಾಕ್ಸ್ ಚೌಕಟ್ಟಿನಲ್ಲಿ ಬರಲಿ. |
| `camera.drop` | Photo of the wire where it reaches the house. | ఇంటికి వైర్ చేరే చోటు ఫోటో తీయండి. | ಮನೆಗೆ ವೈರ್ ಬರುವ ಜಾಗದ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `camera.meter` | Photo of the meter screen. The numbers must be clear. | మీటర్ స్క్రీన్ ఫోటో తీయండి. అంకెలు స్పష్టంగా కనిపించాలి. | ಮೀಟರ್ ಪರದೆಯ ಫೋಟೋ ತೆಗೆಯಿರಿ. ಅಂಕೆಗಳು ಸ್ಪಷ್ಟವಾಗಿ ಕಾಣಬೇಕು. |
| `camera.danger` | Stay back. Take the photo from where you are. | దూరంగానే ఉండండి. మీరు ఉన్న చోటు నుండే ఫోటో తీయండి. | ದೂರದಲ್ಲೇ ಇರಿ. ನೀವು ಇರುವ ಜಾಗದಿಂದಲೇ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `camera.take` | Take photo | ఫోటో తీయండి | ಫೋಟೋ ತೆಗೆಯಿರಿ |
| `camera.open` | Open camera | కెమెరా తెరవండి | ಕ್ಯಾಮೆರಾ ತೆರೆಯಿರಿ |
| `camera.starting` | Starting camera | కెమెరా మొదలవుతోంది | ಕ್ಯಾಮೆರಾ ಆರಂಭವಾಗುತ್ತಿದೆ |
| `camera.blocked` | Camera is blocked for this app. | ఈ యాప్‌కు కెమెరా అనుమతి లేదు. | ಈ ಆ್ಯಪ್‌ಗೆ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಇಲ್ಲ. |
| `camera.saving` | Saving photo | ఫోటో సేవ్ అవుతోంది | ಫೋಟೋ ಉಳಿಸಲಾಗುತ್ತಿದೆ |
| `camera.retake` | Photo again | మళ్ళీ ఫోటో | ಮತ್ತೆ ಫೋಟೋ |
| `gps.searching` | Finding your place. Wait for the green tick. | మీ స్థలం వెతుకుతోంది. ఆకుపచ్చ టిక్ కోసం ఆగండి. | ನಿಮ್ಮ ಸ್ಥಳ ಹುಡುಕುತ್ತಿದೆ. ಹಸಿರು ಟಿಕ್‌ಗಾಗಿ ಕಾಯಿರಿ. |
| `gps.good` | Place found | స్థలం దొరికింది | ಸ್ಥಳ ಸಿಕ್ಕಿದೆ |
| `gps.rough` | Place found roughly. The office will check it. | స్థలం సుమారుగా దొరికింది. ఆఫీస్ సరిచూస్తుంది. | ಸ್ಥಳ ಅಂದಾಜಾಗಿ ಸಿಕ್ಕಿದೆ. ಆಫೀಸ್ ಪರಿಶೀಲಿಸುತ್ತದೆ. |
| `gps.openSky` | Go to open sky. Wait for the green tick. | ఆకాశం కనిపించే చోటుకు వెళ్ళండి. ఆకుపచ్చ టిక్ కోసం ఆగండి. | ತೆರೆದ ಆಕಾಶ ಇರುವ ಕಡೆ ಹೋಗಿ. ಹಸಿರು ಟಿಕ್‌ಗಾಗಿ ಕಾಯಿರಿ. |
| `gps.officePlace` | Save without place. Office will place it. | స్థలం లేకుండా సేవ్ చేయండి. ఆఫీస్ పెడుతుంది. | ಸ್ಥಳ ಇಲ್ಲದೆ ಉಳಿಸಿ. ಆಫೀಸ್ ಇಡುತ್ತದೆ. |
| `gps.blocked` | Location is blocked for this app. | ఈ యాప్‌కు లొకేషన్ అనుమతి లేదు. | ಈ ಆ್ಯಪ್‌ಗೆ ಲೊಕೇಶನ್ ಅನುಮತಿ ಇಲ್ಲ. |
| `gps.unavailable` | This phone gives no location here. | ఈ ఫోన్ ఇక్కడ లొకేషన్ ఇవ్వడం లేదు. | ಈ ಫೋನ್ ಇಲ್ಲಿ ಲೊಕೇಶನ್ ಕೊಡುತ್ತಿಲ್ಲ. |
| `gps.howToAllow` | How to allow | అనుమతి ఎలా ఇవ్వాలి | ಅನುಮತಿ ಹೇಗೆ ಕೊಡುವುದು |
| `same.title` | {kind, select, pole {Is it the same pole?} box {Is it the same box?} other {Is it the same house?}} | {kind, select, pole {ఇదే పోల్ ఆ?} box {ఇదే బాక్స్ ఆ?} other {ఇదే ఇల్లు ఆ?}} | {kind, select, pole {ಇದೇ ಕಂಬವೇ?} box {ಇದೇ ಬಾಕ್ಸೇ?} other {ಇದೇ ಮನೆಯೇ?}} |
| `same.yes` | Same: {name} | ఇదే: {name} | ಇದೇ: {name} |
| `same.new` | No, a new one | కాదు, కొత్తది | ಇಲ್ಲ, ಹೊಸದು |
| `same.noPhoto` | No photo | ఫోటో లేదు | ಫೋಟೋ ಇಲ್ಲ |
| `already.title` | Already on the map | ఇది ఇప్పటికే మ్యాప్‌లో ఉంది | ಇದು ಈಗಾಗಲೇ ನಕ್ಷೆಯಲ್ಲಿದೆ |
| `already.body` | Nothing new was added. The next one will come after {name}. | కొత్తగా ఏమీ జోడించలేదు. తర్వాతది {name} తర్వాత వస్తుంది. | ಹೊಸದಾಗಿ ಏನೂ ಸೇರಿಸಿಲ್ಲ. ಮುಂದಿನದು {name} ನಂತರ ಬರುತ್ತದೆ. |
| `tag.title` | Point the camera at the tag | కెమెరాను ట్యాగ్ వైపు చూపండి | ಕ್ಯಾಮೆರಾವನ್ನು ಟ್ಯಾಗ್ ಕಡೆ ತೋರಿಸಿ |
| `tag.none` | No tag | ట్యాగ్ లేదు | ಟ್ಯಾಗ್ ಇಲ್ಲ |
| `tag.read` | Tag read | ట్యాగ్ చదివింది | ಟ್ಯಾಗ್ ಓದಲಾಗಿದೆ |
| `tag.known` | This tag is already saved: {name} | ఈ ట్యాగ్ ఇప్పటికే సేవ్ అయింది: {name} | ಈ ಟ್ಯಾಗ್ ಈಗಾಗಲೇ ಉಳಿಸಲಾಗಿದೆ: {name} |
| `tag.loading` | Starting scanner | స్కానర్ మొదలవుతోంది | ಸ್ಕ್ಯಾನರ್ ಆರಂಭವಾಗುತ್ತಿದೆ |
| `tag.failed` | The scanner did not start. Tap No tag. | స్కానర్ మొదలుకాలేదు. ట్యాగ్ లేదు నొక్కండి. | ಸ್ಕ್ಯಾನರ್ ಆರಂಭವಾಗಲಿಲ್ಲ. ಟ್ಯಾಗ್ ಇಲ್ಲ ಒತ್ತಿರಿ. |
| `q.owner` | Whose pole is it? | ఇది ఎవరి పోల్? | ಇದು ಯಾರ ಕಂಬ? |
| `q.owner.telecom` | Cable pole | కేబుల్ పోల్ | ಕೇಬಲ್ ಕಂಬ |
| `q.owner.electricity` | Electric pole | కరెంట్ పోల్ | ಕರೆಂಟ್ ಕಂಬ |
| `q.material` | What is the pole made of? | పోల్ దేనితో చేశారు? | ಕಂಬ ಯಾವುದರಿಂದ ಮಾಡಿದ್ದು? |
| `q.material.concrete` | Cement | సిమెంట్ | ಸಿಮೆಂಟ್ |
| `q.material.iron` | Iron | ఇనుము | ಕಬ್ಬಿಣ |
| `q.material.wood` | Wood | చెక్క | ಮರ |
| `q.box` | What kind of box? | ఏ రకమైన బాక్స్? | ಯಾವ ರೀತಿಯ ಬಾಕ್ಸ್? |
| `q.box.street_box` | Street box | వీధి బాక్స్ | ಬೀದಿ ಬಾಕ್ಸ್ |
| `q.box.joint_box` | Joint box | జాయింట్ బాక్స్ | ಜಾಯಿಂಟ್ ಬಾಕ್ಸ್ |
| `choice.unknown` | Don't know | తెలియదు | ಗೊತ್ತಿಲ್ಲ |
| `customer.title` | Which customer? | ఏ కస్టమర్? | ಯಾವ ಗ್ರಾಹಕರು? |
| `customer.search` | Search name or phone number | పేరు లేదా ఫోన్ నంబర్ వెతకండి | ಹೆಸರು ಅಥವಾ ಫೋನ್ ನಂಬರ್ ಹುಡುಕಿ |
| `customer.notListed` | Not in the list | జాబితాలో లేరు | ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ |
| `customer.none` | No customer found. Search by name. | కస్టమర్ దొరకలేదు. పేరుతో వెతకండి. | ಗ್ರಾಹಕರು ಸಿಗಲಿಲ್ಲ. ಹೆಸರಿನಿಂದ ಹುಡುಕಿ. |
| `customer.distance` | {meters} m away | {meters} మీ. దూరం | {meters} ಮೀ. ದೂರ |
| `summary.title` | Check, then save | చూసి, సేవ్ చేయండి | ನೋಡಿ, ನಂತರ ಉಳಿಸಿ |
| `summary.save` | Save | సేవ్ చేయండి | ಉಳಿಸಿ |
| `summary.fix` | Fix | సరిచేయండి | ಸರಿಪಡಿಸಿ |
| `summary.officePlace` | Office must place this | దీన్ని ఆఫీస్ మ్యాప్‌లో పెట్టాలి | ಇದನ್ನು ಆಫೀಸ್ ನಕ್ಷೆಯಲ್ಲಿ ಇಡಬೇಕು |
| `summary.tag` | Tag: {tag} | ట్యాగ్: {tag} | ಟ್ಯಾಗ್: {tag} |
| `summary.after` | Comes after {name} | {name} తర్వాత | {name} ನಂತರ |
| `summary.customer` | For {name} | {name} కోసం | {name} ಅವರಿಗಾಗಿ |
| `summary.saving` | Saving | సేవ్ అవుతోంది | ಉಳಿಸಲಾಗುತ್ತಿದೆ |
| `fix.title` | What do you want to fix? | ఏమి సరిచేయాలి? | ಏನು ಸರಿಪಡಿಸಬೇಕು? |
| `fix.tag` | Tag again | మళ్ళీ ట్యాగ్ | ಮತ್ತೆ ಟ್ಯಾಗ್ |
| `fix.answers` | Answers again | మళ్ళీ జవాబులు | ಮತ್ತೆ ಉತ್ತರಗಳು |
| `fix.customer` | Customer again | మళ్ళీ కస్టమర్ | ಮತ್ತೆ ಗ್ರಾಹಕರು |
| `fix.number` | Number again | మళ్ళీ అంకె | ಮತ್ತೆ ಅಂಕೆ |
| `fix.discard` | Delete this, do not save | దీన్ని తొలగించండి, సేవ్ చేయవద్దు | ಇದನ್ನು ಅಳಿಸಿ, ಉಳಿಸಬೇಡಿ |
| `fix.discardAsk` | Delete this photo and answers? | ఈ ఫోటో, జవాబులు తొలగించాలా? | ಈ ಫೋಟೋ ಮತ್ತು ಉತ್ತರಗಳನ್ನು ಅಳಿಸಬೇಕೆ? |
| `fix.keep` | Keep it | ఉంచండి | ಇಟ್ಟುಕೊಳ್ಳಿ |
| `map.offline` | The map picture needs internet. Your work is still saved on the phone. | మ్యాప్ బొమ్మకు ఇంటర్నెట్ కావాలి. మీ పని ఫోన్‌లో సేవ్ అవుతుంది. | ನಕ್ಷೆ ಚಿತ್ರಕ್ಕೆ ಇಂಟರ್ನೆಟ್ ಬೇಕು. ನಿಮ್ಮ ಕೆಲಸ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಯುತ್ತದೆ. |
| `saved.title` | Saved on phone | ఫోన్‌లో సేవ్ అయింది | ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ |
| `saved.next` | {kind, select, pole {Next pole} box {Next box} drop {Next house} light {Next reading} other {Report another}} | {kind, select, pole {తర్వాత పోల్} box {తర్వాత బాక్స్} drop {తర్వాత ఇల్లు} light {తర్వాత రీడింగ్} other {ఇంకొకటి తెలియజేయండి}} | {kind, select, pole {ಮುಂದಿನ ಕಂಬ} box {ಮುಂದಿನ ಬಾಕ್ಸ್} drop {ಮುಂದಿನ ಮನೆ} light {ಮುಂದಿನ ರೀಡಿಂಗ್} other {ಇನ್ನೊಂದು ತಿಳಿಸಿ}} |
| `saved.undo` | Undo | రద్దు చేయండి | ರದ್ದು ಮಾಡಿ |
| `saved.finished` | Finished | అయిపోయింది | ಮುಗಿಯಿತು |
| `saved.undone` | Removed. Nothing else changed. | తొలగించబడింది. ఇంకేమీ మారలేదు. | ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಬೇರೆ ಏನೂ ಬದಲಾಗಿಲ್ಲ. |
| `saved.undoHint` | Made a mistake? Tap Undo. | తప్పు జరిగిందా? రద్దు చేయండి నొక్కండి. | ತಪ್ಪಾಯಿತೇ? ರದ್ದು ಮಾಡಿ ಒತ್ತಿರಿ. |
| `saved.failed` | Not saved on phone. Tap Try again. If it fails again, call your supervisor. | ఫోన్‌లో సేవ్ కాలేదు. మళ్ళీ ప్రయత్నించండి నొక్కండి. మళ్ళీ విఫలమైతే సూపర్‌వైజర్‌కు కాల్ చేయండి. | ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಒತ್ತಿರಿ. ಮತ್ತೆ ವಿಫಲವಾದರೆ ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ. |
| `pad.title` | Type the numbers on the meter | మీటర్‌పై ఉన్న అంకెలు టైప్ చేయండి | ಮೀಟರ್‌ನಲ್ಲಿರುವ ಅಂಕೆಗಳನ್ನು ಒತ್ತಿರಿ |
| `pad.hint` | Skip the minus sign and the dot. | మైనస్, చుక్క అవసరం లేదు. | ಮೈನಸ್ ಮತ್ತು ಚುಕ್ಕೆ ಬೇಡ. |
| `pad.delete` | Delete | తొలగించు | ಅಳಿಸು |
| `pad.clear` | Clear | అన్నీ తొలగించు | ಎಲ್ಲಾ ಅಳಿಸು |
| `pad.ok` | Good light | లైట్ బాగుంది | ಲೈಟ್ ಚೆನ್ನಾಗಿದೆ |
| `pad.low_margin` | Weak light. Save it. The office will look. | లైట్ తక్కువగా ఉంది. సేవ్ చేయండి. ఆఫీస్ చూస్తుంది. | ಲೈಟ್ ಕಡಿಮೆ ಇದೆ. ಉಳಿಸಿ. ಆಫೀಸ್ ನೋಡುತ್ತದೆ. |
| `pad.too_weak` | Very weak light. Check the number, then save. | లైట్ చాలా తక్కువ. అంకె సరిచూసి సేవ్ చేయండి. | ಲೈಟ್ ತುಂಬಾ ಕಡಿಮೆ. ಅಂಕೆ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಉಳಿಸಿ. |
| `pad.too_much_light` | Too much light. Check the number, then save. | లైట్ ఎక్కువగా ఉంది. అంకె సరిచూసి సేవ్ చేయండి. | ಲೈಟ್ ಹೆಚ್ಚಾಗಿದೆ. ಅಂಕೆ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಉಳಿಸಿ. |
| `pad.check_number` | Check the number on the meter. | మీటర్‌పై అంకె సరిచూడండి. | ಮೀಟರ್‌ನಲ್ಲಿರುವ ಅಂಕೆ ಪರಿಶೀಲಿಸಿ. |
| `pad.empty` | Type the numbers first. | ముందు అంకెలు టైప్ చేయండి. | ಮೊದಲು ಅಂಕೆಗಳನ್ನು ಒತ್ತಿರಿ. |
| `danger.rulesTitle` | Stay safe | జాగ్రత్తగా ఉండండి | ಸುರಕ್ಷಿತವಾಗಿರಿ |
| `danger.saved` | Danger reported. Stay away and keep others away. | ప్రమాదం తెలియజేయబడింది. దూరంగా ఉండండి, ఇతరులను దూరంగా ఉంచండి. | ಅಪಾಯ ತಿಳಿಸಲಾಗಿದೆ. ದೂರವಿರಿ, ಇತರರನ್ನೂ ದೂರವಿಡಿ. |
| `safety.noClimb` | Mapping never needs climbing or touching a pole. | మ్యాపింగ్‌కు పోల్ ఎక్కడం లేదా తాకడం ఎప్పుడూ అవసరం లేదు. | ಮ್ಯಾಪಿಂಗ್‌ಗೆ ಕಂಬ ಹತ್ತುವುದು ಅಥವಾ ಮುಟ್ಟುವುದು ಎಂದಿಗೂ ಬೇಕಿಲ್ಲ. |
| `safety.live` | Treat every wire, stay and metal pole as live. | ప్రతి వైర్, స్టే వైర్, ఇనుప పోల్‌లో కరెంట్ ఉందని భావించండి. | ಪ್ರತಿ ವೈರ್, ಸ್ಟೇ ವೈರ್ ಮತ್ತು ಕಬ್ಬಿಣದ ಕಂಬದಲ್ಲಿ ಕರೆಂಟ್ ಇದೆ ಎಂದು ತಿಳಿಯಿರಿ. |
| `safety.rain` | Do not survey poles in rain or lightning. | వర్షం లేదా పిడుగుల సమయంలో పోల్స్ సర్వే చేయవద్దు. | ಮಳೆ ಅಥವಾ ಸಿಡಿಲಿನ ಸಮಯದಲ್ಲಿ ಕಂಬಗಳ ಸರ್ವೇ ಮಾಡಬೇಡಿ. |
| `safety.rods` | Do not raise rods or ladders near wires. | వైర్ల దగ్గర కర్రలు లేదా నిచ్చెనలు ఎత్తవద్దు. | ವೈರ್‌ಗಳ ಹತ್ತಿರ ಕೋಲು ಅಥವಾ ಏಣಿ ಎತ್ತಬೇಡಿ. |
| `safety.report` | Report a leaning, sparking or burning pole to the electricity office. | వంగిన, మెరుపులు వచ్చే లేదా కాలుతున్న పోల్ గురించి కరెంట్ ఆఫీస్‌కు చెప్పండి. | ಬಾಗಿದ, ಕಿಡಿ ಬರುವ ಅಥವಾ ಉರಿಯುತ್ತಿರುವ ಕಂಬದ ಬಗ್ಗೆ ಕರೆಂಟ್ ಆಫೀಸ್‌ಗೆ ತಿಳಿಸಿ. |
| `safety.traffic` | Do not stand in traffic for a photo. | ఫోటో కోసం ట్రాఫిక్‌లో నిలబడవద్దు. | ಫೋಟೋಗಾಗಿ ಟ್ರಾಫಿಕ್‌ನಲ್ಲಿ ನಿಲ್ಲಬೇಡಿ. |
| `safety.riding` | Do not use the phone while riding. | బండి నడుపుతూ ఫోన్ వాడవద్దు. | ಗಾಡಿ ಓಡಿಸುವಾಗ ಫೋನ್ ಬಳಸಬೇಡಿ. |
| `safety.draft` | Draft safety words. A safety officer has not checked them yet. | ఇవి ముసాయిదా భద్రతా మాటలు. భద్రతా అధికారి ఇంకా సరిచూడలేదు. | ಇವು ಕರಡು ಸುರಕ್ಷತಾ ಮಾತುಗಳು. ಸುರಕ್ಷತಾ ಅಧಿಕಾರಿ ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ. |
| `help.title` | Before you start | మొదలుపెట్టే ముందు | ಆರಂಭಿಸುವ ಮೊದಲು |
| `help.camera` | The phone will ask to use the camera. Tap Allow. | ఫోన్ కెమెరా అనుమతి అడుగుతుంది. Allow నొక్కండి. | ಫೋನ್ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಕೇಳುತ್ತದೆ. Allow ಒತ್ತಿರಿ. |
| `help.location` | The phone will ask for your location. Tap Allow. | ఫోన్ లొకేషన్ అనుమతి అడుగుతుంది. Allow నొక్కండి. | ಫೋನ್ ಲೊಕೇಶನ್ ಅನುಮತಿ ಕೇಳುತ್ತದೆ. Allow ಒತ್ತಿರಿ. |
| `help.denied` | Tapped Block by mistake? Tap the lock next to the web address, then Permissions, then Allow. | పొరపాటున Block నొక్కారా? వెబ్ అడ్రస్ పక్కన తాళం గుర్తు నొక్కండి, తర్వాత Permissions, తర్వాత Allow. | ತಪ್ಪಾಗಿ Block ಒತ್ತಿದಿರಾ? ವೆಬ್ ವಿಳಾಸದ ಪಕ್ಕದ ಬೀಗದ ಗುರುತು ಒತ್ತಿ, ನಂತರ Permissions, ನಂತರ Allow. |
| `help.undo` | Every save can be undone. | ప్రతి సేవ్‌ను రద్దు చేయవచ్చు. | ಪ್ರತಿ ಉಳಿಕೆಯನ್ನು ರದ್ದು ಮಾಡಬಹುದು. |
| `help.start` | Start | మొదలుపెట్టండి | ಆರಂಭಿಸಿ |
| `help.insecure` | This address is not secure (no https). Camera and location will not work. Tell the office. | ఈ అడ్రస్ సురక్షితం కాదు (https లేదు). కెమెరా, లొకేషన్ పనిచేయవు. ఆఫీస్‌కు చెప్పండి. | ಈ ವಿಳಾಸ ಸುರಕ್ಷಿತವಲ್ಲ (https ಇಲ್ಲ). ಕ್ಯಾಮೆರಾ ಮತ್ತು ಲೊಕೇಶನ್ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. ಆಫೀಸ್‌ಗೆ ತಿಳಿಸಿ. |
| `lang.title` | Choose language | భాష ఎంచుకోండి | ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ |
| `lang.draft` | Draft words, being checked | ముసాయిదా మాటలు, సరిచూస్తున్నారు | ಕರಡು ಮಾತುಗಳು, ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ |
| `common.back` | Back | వెనుకకు | ಹಿಂದೆ |
| `common.home` | Home | హోమ్ | ಮುಖಪುಟ |
| `common.tryAgain` | Try again | మళ్ళీ ప్రయత్నించండి | ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ |
| `common.listen` | Listen | వినండి | ಕೇಳಿ |
| `storage.failed` | Phone storage is not working. Work cannot be saved. Call your supervisor. | ఫోన్ స్టోరేజ్ పనిచేయడం లేదు. పని సేవ్ కాదు. సూపర్‌వైజర్‌కు కాల్ చేయండి. | ಫೋನ್ ಸ್ಟೋರೇಜ್ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ. ಕೆಲಸ ಉಳಿಯುವುದಿಲ್ಲ. ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ. |
