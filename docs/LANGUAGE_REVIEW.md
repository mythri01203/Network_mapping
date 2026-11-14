# Telugu and Kannada wording: review needed

**Status: every Telugu and Kannada text in the field capture flow is a DRAFT.** It was written without a native speaker or a field crew. Each string is marked `reviewed: false` in `apps/web/src/i18n/messages.ts`, and nothing on screen says it has been checked. The language picker labels both languages "Draft words, being checked".

Engineer screens are English only. Only the phone capture flow (`/capture`), the technician's jobs (`/jobs`, Phase 8: keys `jobs.*`) and the "Someone else changed this" choice (`conflict.*`) are translated. The Phase 8 strings are drafts written the same way, with the same review needed; "TEST", "Allow" and similar English words inside them are deliberate.

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
| `tag.barcodeHint` | QR code or barcode, both work. | క్యూఆర్ కోడ్ లేదా బార్‌కోడ్, ఏదైనా పనిచేస్తుంది. | ಕ್ಯೂಆರ್ ಕೋಡ್ ಅಥವಾ ಬಾರ್‌ಕೋಡ್, ಯಾವುದಾದರೂ ಸರಿ. |
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
| `saved.review` | The office will check it, then it goes on the network map. | ఆఫీస్ సరిచూసిన తర్వాత ఇది నెట్‌వర్క్ మ్యాప్‌లోకి వెళ్తుంది. | ಆಫೀಸ್ ಪರಿಶೀಲಿಸಿದ ನಂತರ ಇದು ನೆಟ್‌ವರ್ಕ್ ನಕ್ಷೆಗೆ ಹೋಗುತ್ತದೆ. |
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
| `home.history` | What was sent | ఏమి పంపబడింది | ಏನು ಕಳುಹಿಸಲಾಗಿದೆ |
| `history.title` | What this phone sent | ఈ ఫోన్ ఏమి పంపింది | ಈ ಫೋನ್ ಏನು ಕಳುಹಿಸಿದೆ |
| `history.empty` | Nothing sent yet. | ఇంకా ఏమీ పంపలేదు. | ಇನ್ನೂ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. |
| `history.sent` | Sent | పంపబడింది | ಕಳುಹಿಸಲಾಗಿದೆ |
| `history.refused` | Not accepted | అంగీకరించలేదు | ಸ್ವೀಕರಿಸಲಿಲ್ಲ |
| `history.conflict` | Someone else changed it too | ఇంకెవరో కూడా మార్చారు | ಬೇರೆಯವರೂ ಬದಲಾಯಿಸಿದ್ದಾರೆ |
| `history.photo` | Photo | ఫోటో | ಫೋಟೋ |
| `history.items` | {count, plural, one {# item} other {# items}} | {count, plural, one {# అంశం} other {# అంశాలు}} | {count, plural, one {# ವಸ್ತು} other {# ವಸ್ತುಗಳು}} |
| `history.keptOnPhone` | It stays on the phone. Call your supervisor. | ఇది ఫోన్‌లోనే ఉంటుంది. సూపర్‌వైజర్‌కు కాల్ చేయండి. | ಇದು ಫೋನ್‌ನಲ್ಲೇ ಇರುತ್ತದೆ. ಸೂಪರ್‌ವೈಸರ್‌ಗೆ ಕರೆ ಮಾಡಿ. |
| `jobs.tile` | My jobs | నా పనులు | ನನ್ನ ಕೆಲಸಗಳು |
| `jobs.who` | Who are you? | మీరు ఎవరు? | ನೀವು ಯಾರು? |
| `jobs.notListed` | My name is not here | నా పేరు ఇక్కడ లేదు | ನನ್ನ ಹೆಸರು ಇಲ್ಲಿ ಇಲ್ಲ |
| `jobs.notListedHelp` | Ask the office to put your name on your job. | మీ పని మీద మీ పేరు పెట్టమని ఆఫీస్‌ను అడగండి. | ನಿಮ್ಮ ಕೆಲಸಕ್ಕೆ ನಿಮ್ಮ ಹೆಸರು ಹಾಕಲು ಆಫೀಸ್‌ಗೆ ಕೇಳಿ. |
| `jobs.notMe` | Not me | నేను కాదు | ನಾನಲ್ಲ |
| `jobs.none` | No jobs for you now. | ఇప్పుడు మీకు పనులు లేవు. | ಈಗ ನಿಮಗೆ ಕೆಲಸಗಳಿಲ್ಲ. |
| `jobs.finished` | Finished jobs | పూర్తయిన పనులు | ಮುಗಿದ ಕೆಲಸಗಳು |
| `jobs.statusNew` | New job | కొత్త పని | ಹೊಸ ಕೆಲಸ |
| `jobs.statusStarted` | Started | మొదలైంది | ಆರಂಭವಾಗಿದೆ |
| `jobs.statusHold` | Stopped for now | ప్రస్తుతానికి ఆపారు | ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ |
| `jobs.statusCheck` | Repair done. Check needed. | రిపేర్ అయింది. చెక్ చేయాలి. | ರಿಪೇರಿ ಆಗಿದೆ. ಪರಿಶೀಲನೆ ಬೇಕು. |
| `jobs.statusDone` | Done | పూర్తయింది | ಮುಗಿದಿದೆ |
| `jobs.test` | TEST job. Not real. | TEST పని. నిజం కాదు. | TEST ಕೆಲಸ. ನಿಜವಲ್ಲ. |
| `jobs.where` | Go to: {place} | ఇక్కడికి వెళ్ళండి: {place} | ಇಲ್ಲಿಗೆ ಹೋಗಿ: {place} |
| `jobs.navigate` | Show the way | దారి చూపించు | ದಾರಿ ತೋರಿಸಿ |
| `jobs.start` | Start job | పని మొదలుపెట్టండి | ಕೆಲಸ ಆರಂಭಿಸಿ |
| `jobs.photoBefore` | Photo before | ముందు ఫోటో | ಮೊದಲಿನ ಫೋಟೋ |
| `jobs.photoAfter` | Photo after | తర్వాత ఫోటో | ನಂತರದ ಫೋಟೋ |
| `jobs.cameraBefore` | Photo of the problem before you touch it. | తాకే ముందు సమస్య ఫోటో తీయండి. | ಮುಟ್ಟುವ ಮೊದಲು ಸಮಸ್ಯೆಯ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `jobs.cameraAfter` | Photo of the repair when it is finished. | రిపేర్ అయ్యాక దాని ఫోటో తీయండి. | ರಿಪೇರಿ ಮುಗಿದ ಮೇಲೆ ಅದರ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `jobs.cameraService` | Photo of the house device with its lights on. | లైట్లు వెలుగుతున్న ఇంటి పరికరం ఫోటో తీయండి. | ದೀಪಗಳು ಉರಿಯುತ್ತಿರುವ ಮನೆಯ ಸಾಧನದ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `jobs.steps` | Tap each step when it is done | ప్రతి దశ పూర్తయ్యాక దాన్ని నొక్కండి | ಪ್ರತಿ ಹಂತ ಮುಗಿದಾಗ ಅದನ್ನು ಒತ್ತಿರಿ |
| `jobs.material` | Material used | వాడిన సామాను | ಬಳಸಿದ ಸಾಮಗ್ರಿ |
| `jobs.materialWhat` | What did you use? | మీరు ఏమి వాడారు? | ನೀವು ಏನು ಬಳಸಿದಿರಿ? |
| `jobs.materialHow` | How many {unit}? | ఎన్ని {unit}? | ಎಷ್ಟು {unit}? |
| `jobs.mat.drop` | House wire | ఇంటి వైర్ | ಮನೆ ವೈರ್ |
| `jobs.mat.connector` | Connector | కనెక్టర్ | ಕನೆಕ್ಟರ್ |
| `jobs.mat.sleeve` | Splice sleeve | స్ప్లైస్ స్లీవ్ | ಸ್ಪ್ಲೈಸ್ ಸ್ಲೀವ್ |
| `jobs.mat.patch` | Patch cord | ప్యాచ్ కార్డ్ | ಪ್ಯಾಚ್ ಕಾರ್ಡ್ |
| `jobs.mat.splitter` | Splitter (divider) | స్ప్లిటర్ (విభాజకం) | ಸ್ಪ್ಲಿಟರ್ (ವಿಭಾಜಕ) |
| `jobs.unit.m` | metres | మీటర్లు | ಮೀಟರ್ |
| `jobs.unit.pcs` | pieces | ముక్కలు | ತುಂಡುಗಳು |
| `jobs.note` | Add a note | నోట్ రాయండి | ಟಿಪ್ಪಣಿ ಬರೆಯಿರಿ |
| `jobs.noteHint` | Write what you found. You can leave this out. | మీరు ఏమి చూశారో రాయండి. రాయకపోయినా పరవాలేదు. | ನೀವು ಏನು ಕಂಡಿರಿ ಎಂದು ಬರೆಯಿರಿ. ಬರೆಯದಿದ್ದರೂ ಪರವಾಗಿಲ್ಲ. |
| `jobs.hold` | Stop for now | ప్రస్తుతానికి ఆపండి | ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಿ |
| `jobs.resume` | Start again | మళ్ళీ మొదలుపెట్టండి | ಮತ್ತೆ ಆರಂಭಿಸಿ |
| `jobs.repairDone` | Repair done | రిపేర్ అయింది | ರಿಪೇರಿ ಆಗಿದೆ |
| `jobs.needAfter` | First take the photo after the repair. | ముందు రిపేర్ తర్వాత ఫోటో తీయండి. | ಮೊದಲು ರಿಪೇರಿಯ ನಂತರದ ಫೋಟೋ ತೆಗೆಯಿರಿ. |
| `jobs.checkTitle` | Check the repair | రిపేర్‌ను చెక్ చేయండి | ರಿಪೇರಿಯನ್ನು ಪರಿಶೀಲಿಸಿ |
| `jobs.checkReading` | Light level reading | లైట్ లెవెల్ రీడింగ్ | ಲೈಟ್ ಲೆವೆಲ್ ರೀಡಿಂಗ್ |
| `jobs.checkPhoto` | Photo of the working device | పనిచేస్తున్న పరికరం ఫోటో | ಕೆಲಸ ಮಾಡುತ್ತಿರುವ ಸಾಧನದ ಫೋಟೋ |
| `jobs.checkWhere` | At which house did you check? | ఏ ఇంటి దగ్గర చెక్ చేశారు? | ಯಾವ ಮನೆಯಲ್ಲಿ ಪರಿಶೀಲಿಸಿದಿರಿ? |
| `jobs.checkSaved` | Check saved. The office will close the job. | చెక్ సేవ్ అయింది. ఆఫీస్ పనిని ముగిస్తుంది. | ಪರಿಶೀಲನೆ ಉಳಿಸಲಾಗಿದೆ. ಆಫೀಸ್ ಕೆಲಸವನ್ನು ಮುಗಿಸುತ್ತದೆ. |
| `jobs.saved` | Saved | సేవ్ అయింది | ಉಳಿಸಲಾಗಿದೆ |
| `jobs.backToJob` | Back to the job | పనికి తిరిగి వెళ్ళండి | ಕೆಲಸಕ್ಕೆ ಹಿಂತಿರುಗಿ |
| `jobs.myJobs` | All my jobs | నా అన్ని పనులు | ನನ್ನ ಎಲ್ಲಾ ಕೆಲಸಗಳು |
| `jobs.closed` | This job is finished. Call the office if something is wrong. | ఈ పని పూర్తయింది. ఏదైనా తప్పు ఉంటే ఆఫీస్‌కు కాల్ చేయండి. | ಈ ಕೆಲಸ ಮುಗಿದಿದೆ. ಏನಾದರೂ ತಪ್ಪಿದ್ದರೆ ಆಫೀಸ್‌ಗೆ ಕರೆ ಮಾಡಿ. |
| `jobs.notSaved` | Not saved. Try again. | సేవ్ కాలేదు. మళ్ళీ ప్రయత్నించండి. | ಉಳಿಸಲಾಗಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. |
| `conflict.title` | Someone else changed this | ఇంకొకరు దీన్ని మార్చారు | ಬೇರೆಯವರು ಇದನ್ನು ಬದಲಾಯಿಸಿದ್ದಾರೆ |
| `conflict.body` | While you worked, someone else changed {label}. Both versions are kept. Choose one. | మీరు పని చేస్తున్నప్పుడు ఇంకొకరు {label} మార్చారు. రెండూ దాచి ఉంచాము. ఒకటి ఎంచుకోండి. | ನೀವು ಕೆಲಸ ಮಾಡುವಾಗ ಬೇರೆಯವರು {label} ಬದಲಾಯಿಸಿದರು. ಎರಡನ್ನೂ ಉಳಿಸಲಾಗಿದೆ. ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ. |
| `conflict.theirs` | Theirs (office) | వారిది (ఆఫీస్) | ಅವರದು (ಆಫೀಸ್) |
| `conflict.mine` | Mine (this phone) | నాది (ఈ ఫోన్) | ನನ್ನದು (ಈ ಫೋನ್) |
| `conflict.keepTheirs` | Keep theirs | వారిది ఉంచండి | ಅವರದನ್ನು ಇಡಿ |
| `conflict.keepMine` | Keep mine | నాది ఉంచండి | ನನ್ನದನ್ನು ಇಡಿ |
| `conflict.office` | Office decides | ఆఫీస్ నిర్ణయిస్తుంది | ಆಫೀಸ್ ನಿರ್ಧರಿಸುತ್ತದೆ |
| `conflict.more` | {count} more changes | ఇంకా {count} మార్పులు | ಇನ್ನೂ {count} ಬದಲಾವಣೆಗಳು |
| `conflict.deleted` | Deleted | తొలగించారు | ಅಳಿಸಲಾಗಿದೆ |
| `conflict.kept` | Both versions are kept. The office can see them. | రెండూ దాచి ఉంచాము. ఆఫీస్ చూడగలదు. | ಎರಡನ್ನೂ ಉಳಿಸಲಾಗಿದೆ. ಆಫೀಸ್ ನೋಡಬಹುದು. |
| `login.title` | Log in | లాగిన్ అవ్వండి | ಲಾಗಿನ್ ಆಗಿ |
| `login.whoAreYou` | Who are you? | మీరు ఎవరు? | ನೀವು ಯಾರು? |
| `login.someoneElse` | Someone else | వేరే వ్యక్తి | ಬೇರೆ ವ್ಯಕ್ತಿ |
| `login.name` | Your login name | మీ లాగిన్ పేరు | ನಿಮ್ಮ ಲಾಗಿನ್ ಹೆಸರು |
| `login.password` | Your password | మీ పాస్‌వర్డ్ | ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ |
| `login.show` | Show | చూపించు | ತೋರಿಸು |
| `login.hide` | Hide | దాచు | ಮರೆಮಾಡು |
| `login.go` | Log in | లాగిన్ | ಲಾಗಿನ್ |
| `login.back` | Back | వెనక్కి | ಹಿಂದೆ |
| `login.next` | Next | తర్వాత | ಮುಂದೆ |
| `login.checking` | Checking | పరిశీలిస్తోంది | ಪರಿಶೀಲಿಸುತ್ತಿದೆ |
| `learn.welcomeTitle` | Welcome to FiberGIS – Let's learn together! | ఫైబర్ జీఐఎస్‌కు స్వాగతం – కలిసి నేర్చుకుందాం! | ಫೈಬರ್ ಜಿಐಎಸ್‌ಗೆ ಸ್ವಾಗತ – ಒಟ್ಟಿಗೆ ಕಲಿಯೋಣ! |
| `learn.chooseLanguage` | Choose your language | మీ భాషను ఎంచుకోండి | ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ |
| `learn.start` | Start learning | నేర్చుకోవడం మొదలుపెట్టండి | ಕಲಿಯಲು ಶುರು ಮಾಡಿ |
| `learn.skip` | Skip | వదిలేయండి | ಬಿಟ್ಟುಬಿಡಿ |
| `learn.next` | Next | తర్వాత | ಮುಂದೆ |
| `learn.back` | Back | వెనక్కి | ಹಿಂದೆ |
| `learn.finish` | Finish | పూర్తి | ಮುಗಿಸಿ |
| `learn.play` | Play | వినండి | ಕೇಳಿ |
| `learn.pause` | Pause | ఆపండి | ನಿಲ್ಲಿಸಿ |
| `learn.resume` | Resume | కొనసాగించండి | ಮುಂದುವರಿಸಿ |
| `learn.repeat` | Repeat | మళ్లీ వినండి | ಮತ್ತೆ ಕೇಳಿ |
| `learn.stop` | Stop | ముగించండి | ಮುಗಿಸಿ |
| `learn.noVoice` | Voice is not ready in this language yet. The words are shown below. | ఈ భాషలో వాయిస్ ఇంకా సిద్ధం కాలేదు. మాటలు కింద ఉన్నాయి. | ಈ ಭಾಷೆಯಲ್ಲಿ ಧ್ವನಿ ಇನ್ನೂ ಸಿದ್ಧವಿಲ್ಲ. ಪದಗಳು ಕೆಳಗೆ ಇವೆ. |
| `learn.voiceDraft` | Draft voice: not checked yet. Only the administrator hears this. | డ్రాఫ్ట్ వాయిస్: ఇంకా తనిఖీ కాలేదు. అడ్మిన్‌కు మాత్రమే వినిపిస్తుంది. | ಡ್ರಾಫ್ಟ್ ಧ್ವನಿ: ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ. ಆಡ್ಮಿನ್‌ಗೆ ಮಾತ್ರ ಕೇಳಿಸುತ್ತದೆ. |
| `learn.voiceError` | The voice could not play. Check the connection and tap Play again. | వాయిస్ ప్లే కాలేదు. కనెక్షన్ చూసి మళ్లీ వినండి నొక్కండి. | ಧ್ವನಿ ಪ್ಲೇ ಆಗಲಿಲ್ಲ. ಸಂಪರ್ಕ ನೋಡಿ ಮತ್ತೆ ಕೇಳಿ ಒತ್ತಿ. |
| `learn.offline` | No connection: words and pictures only. | కనెక్షన్ లేదు: మాటలు, బొమ్మలు మాత్రమే. | ಸಂಪರ್ಕ ಇಲ್ಲ: ಪದಗಳು ಮತ್ತು ಚಿತ್ರಗಳು ಮಾತ್ರ. |
| `learn.step` | Step {n} of {total} | {total}లో {n}వ దశ | {total}ರಲ್ಲಿ {n}ನೇ ಹಂತ |
| `learn.example` | Example picture, not your network | ఉదాహరణ బొమ్మ, మీ నెట్‌వర్క్ కాదు | ಉದಾಹರಣೆ ಚಿತ್ರ, ನಿಮ್ಮ ನೆಟ್‌ವರ್ಕ್ ಅಲ್ಲ |
| `learn.open` | Learn FiberGIS | ఫైబర్ జీఐఎస్ నేర్చుకోండి | ಫೈಬರ್ ಜಿಐಎಸ್ ಕಲಿಯಿರಿ |
| `learn.draftWords` | Words not yet checked by a native speaker | మాటలు ఇంకా తెలుగు మాట్లాడేవారు తనిఖీ చేయలేదు | ಪದಗಳನ್ನು ಇನ್ನೂ ಕನ್ನಡ ಮಾತನಾಡುವವರು ಪರಿಶೀಲಿಸಿಲ್ಲ |
| `learn.guide` | Guide | గైడ్ | ಗೈಡ್ |
| `learn.guideChoose` | What should I show you? | నేను ఏమి చూపించాలి? | ನಾನು ಏನು ತೋರಿಸಲಿ? |
| `learn.guideMenu` | Tour of every page | ప్రతి పేజీ పరిచయం | ಪ್ರತಿ ಪುಟದ ಪರಿಚಯ |
| `learn.guideMap` | Map the network step by step | నెట్‌వర్క్‌ను దశలవారీగా మ్యాప్ చేయండి | ನೆಟ್‌ವರ್ಕ್ ಅನ್ನು ಹಂತ ಹಂತವಾಗಿ ನಕ್ಷೆ ಮಾಡಿ |
| `learn.guideReal` | In Map the network, what you place is saved on your real map. Tap Undo to take back a mistake. | Map the networkలో మీరు పెట్టినది మీ అసలు మ్యాప్‌లో సేవ్ అవుతుంది. తప్పును వెనక్కి తీసుకోవడానికి Undo నొక్కండి. | Map the network ನಲ್ಲಿ ನೀವು ಇಟ್ಟದ್ದು ನಿಮ್ಮ ನಿಜವಾದ ನಕ್ಷೆಯಲ್ಲಿ ಉಳಿಯುತ್ತದೆ. ತಪ್ಪನ್ನು ಹಿಂಪಡೆಯಲು Undo ಒತ್ತಿ. |
| `learn.yourTurn` | Your turn: do this now. I am waiting. | ఇప్పుడు మీ వంతు: ఇది చేయండి. నేను ఎదురుచూస్తున్నాను. | ಈಗ ನಿಮ್ಮ ಸರದಿ: ಇದನ್ನು ಮಾಡಿ. ನಾನು ಕಾಯುತ್ತಿದ್ದೇನೆ. |
| `learn.done` | Done. Going on. | అయిపోయింది. ముందుకు వెళ్తున్నాం. | ಆಯಿತು. ಮುಂದೆ ಹೋಗುತ್ತಿದ್ದೇವೆ. |
| `learn.continue` | Continue where you stopped | ఆపిన చోట నుండి కొనసాగించండి | ನಿಲ್ಲಿಸಿದಲ್ಲಿಂದ ಮುಂದುವರಿಸಿ |
| `learn.startAgain` | Start again from the beginning | మొదటి నుండి మళ్లీ మొదలుపెట్టండి | ಮೊದಲಿನಿಂದ ಮತ್ತೆ ಶುರು ಮಾಡಿ |
| `learn.guideTry` | Try it yourself: I wait for you at each step | మీరే చేయండి: ప్రతి దశలో నేను ఎదురుచూస్తాను | ನೀವೇ ಮಾಡಿ: ಪ್ರತಿ ಹಂತದಲ್ಲಿ ನಾನು ಕಾಯುತ್ತೇನೆ |
| `learn.watching` | Watch: I am doing this step now. | చూడండి: ఈ దశను నేను ఇప్పుడు చేస్తున్నాను. | ನೋಡಿ: ಈ ಹಂತವನ್ನು ನಾನು ಈಗ ಮಾಡುತ್ತಿದ್ದೇನೆ. |
| `learn.autoFailed` | I could not do this step by myself. Tap Play to try again. | ఈ దశను నేను స్వయంగా చేయలేకపోయాను. మళ్లీ ప్రయత్నించడానికి Play నొక్కండి. | ಈ ಹಂತವನ್ನು ನಾನೇ ಮಾಡಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು Play ಒತ್ತಿ. |
| `learn.demoNote` | Map the network step by step: I map on your real map by myself. At the end I remove what I made, and no customer is saved. | Map the network step by step: మీ అసలు మ్యాప్‌పై నేనే మ్యాప్ చేస్తాను. చివరలో నేను చేసినవి తీసేస్తాను, కస్టమర్ సేవ్ కాదు. | Map the network step by step: ನಿಮ್ಮ ನಿಜವಾದ ನಕ್ಷೆಯಲ್ಲಿ ನಾನೇ ನಕ್ಷೆ ಮಾಡುತ್ತೇನೆ. ಕೊನೆಯಲ್ಲಿ ನಾನು ಮಾಡಿದ್ದನ್ನು ತೆಗೆಯುತ್ತೇನೆ, ಗ್ರಾಹಕ ಉಳಿಯುವುದಿಲ್ಲ. |
| `learn.guideClose` | Close guide | గైడ్ మూసివేయండి | ಗೈಡ್ ಮುಚ್ಚಿ |
| `learn.hideWords` | Make smaller | చిన్నదిగా చేయండి | ಚಿಕ್ಕದಾಗಿ ಮಾಡಿ |
| `learn.showWords` | Show the words | మాటలు చూపించండి | ಪದಗಳನ್ನು ತೋರಿಸಿ |
| `learn.guideOnly` | The guide only shows. It does not press anything or change your network. | గైడ్ చూపిస్తుంది మాత్రమే. ఏ బటన్ నొక్కదు, మీ నెట్‌వర్క్‌ను మార్చదు. | ಗೈಡ್ ತೋರಿಸುತ್ತದೆ ಮಾತ್ರ. ಯಾವ ಬಟನ್ ಒತ್ತುವುದಿಲ್ಲ, ನಿಮ್ಮ ನೆಟ್‌ವರ್ಕ್ ಬದಲಾಯಿಸುವುದಿಲ್ಲ. |
| `learn.notOnScreen` | This is not on the screen right now. Read the words to know where it is. | ఇది ఇప్పుడు స్క్రీన్‌పై లేదు. ఎక్కడ ఉందో తెలియడానికి మాటలు చదవండి. | ಇದು ಈಗ ಪರದೆಯಲ್ಲಿ ಇಲ್ಲ. ಎಲ್ಲಿದೆ ಎಂದು ತಿಳಿಯಲು ಮಾತುಗಳನ್ನು ಓದಿ. |
| `jobs.noPhotoHint` | Write why no photo is possible. The office will see it. | ఫోటో ఎందుకు తీయలేరో రాయండి. ఆఫీసు చూస్తుంది. | ಫೋಟೋ ಏಕೆ ತೆಗೆಯಲು ಆಗುವುದಿಲ್ಲ ಎಂದು ಬರೆಯಿರಿ. ಆಫೀಸ್ ನೋಡುತ್ತದೆ. |
| `login.notSetUp` | Logins are not set up yet. The office must first make the administrator account on the server computer. Then log in here. | లాగిన్లు ఇంకా సిద్ధం కాలేదు. ముందుగా ఆఫీసు సర్వర్ కంప్యూటర్‌లో అడ్మినిస్ట్రేటర్ ఖాతా చేయాలి. తర్వాత ఇక్కడ లాగిన్ అవ్వండి. | ಲಾಗಿನ್‌ಗಳು ಇನ್ನೂ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಮೊದಲು ಆಫೀಸ್ ಸರ್ವರ್ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಆಡ್ಮಿನಿಸ್ಟ್ರೇಟರ್ ಖಾತೆ ಮಾಡಬೇಕು. ನಂತರ ಇಲ್ಲಿ ಲಾಗಿನ್ ಆಗಿ. |
| `login.kept` | {count} saved on this phone. They are sent after you log in. | {count} ఈ ఫోన్‌లో సేవ్ అయ్యాయి. మీరు లాగిన్ అయ్యాక పంపబడతాయి. | {count} ಈ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿದಿವೆ. ನೀವು ಲಾಗಿನ್ ಆದ ನಂತರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. |
| `login.forgot` | Forgot the password? Ask the office for a new one. | పాస్‌వర్డ్ మర్చిపోయారా? కొత్తది ఆఫీస్‌ను అడగండి. | ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರಾ? ಹೊಸದನ್ನು ಆಫೀಸ್‌ನಲ್ಲಿ ಕೇಳಿ. |
| `login.newPassword` | Choose your own password | మీ సొంత పాస్‌వర్డ్ ఎంచుకోండి | ನಿಮ್ಮದೇ ಪಾಸ್‌ವರ್ಡ್ ಆರಿಸಿ |
| `login.oldPassword` | Password you have now | ఇప్పుడు ఉన్న పాస్‌వర్డ్ | ಈಗಿರುವ ಪಾಸ್‌ವರ್ಡ್ |
| `login.minLength` | At least {count} letters or digits. | కనీసం {count} అక్షరాలు లేదా అంకెలు. | ಕನಿಷ್ಠ {count} ಅಕ್ಷರಗಳು ಅಥವಾ ಅಂಕೆಗಳು. |
| `login.savePassword` | Save password | పాస్‌వర్డ్ సేవ్ చేయండి | ಪಾಸ್‌ವರ್ಡ್ ಉಳಿಸಿ |
| `login.later` | Not now | ఇప్పుడు కాదు | ಈಗ ಬೇಡ |
| `login.offline` | No internet. You can keep working as {name}. Log in when the signal is back. | ఇంటర్నెట్ లేదు. {name}గా పని కొనసాగించవచ్చు. సిగ్నల్ వచ్చాక లాగిన్ అవ్వండి. | ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ. {name} ಆಗಿ ಕೆಲಸ ಮುಂದುವರಿಸಬಹುದು. ಸಿಗ್ನಲ್ ಬಂದ ನಂತರ ಲಾಗಿನ್ ಆಗಿ. |


## 3D view (draft, not checked)

The 3D view (`apps/web/src/features/view3d/i18n.ts`) has its own word list in English, Kannada,
Hindi, Telugu and Tamil. Every non-English text there is a **draft** written without a native
speaker or crew check, the same as above. Hindi and Tamil are new to the app and appear only in the
3D view. Check them with crews before relying on them, in particular these terms:

| English | Kannada | Hindi | Telugu | Tamil |
|---|---|---|---|---|
| Main Office Box (OLT) | ಮುಖ್ಯ ಆಫೀಸ್ ಬಾಕ್ಸ್ | मुख्य ऑफिस बॉक्स | మెయిన్ ఆఫీస్ బాక్స్ | முதன்மை அலுவலக பெட்டி |
| Home Connection Box (FAT) | ಮನೆ ಸಂಪರ್ಕ ಬಾಕ್ಸ್ | घर कनेक्शन बॉक्स | ఇంటి కనెక్షన్ బాక్స్ | வீட்டு இணைப்பு பெட்டி |
| Customer modem (ONT) | ಗ್ರಾಹಕ ಮೋಡೆಮ್ | ग्राहक मॉडेम | కస్టమర్ మోడెమ్ | வாடிக்கையாளர் மோடம் |
| House cable (drop) | ಮನೆ ಕೇಬಲ್ | घर केबल | ఇంటి కేబుల్ | வீட்டு கேபிள் |
| Main cable (feeder) | ಮುಖ್ಯ ಕೇಬಲ್ | मुख्य केबल | మెయిన్ కేబుల్ | முதன்மை கேபிள் |
| Light loss (estimated) | ಬೆಳಕಿನ ನಷ್ಟ (ಅಂದಾಜು) | रोशनी का नुकसान (अनुमान) | లైట్ నష్టం (అంచనా) | ஒளி இழப்பு (மதிப்பீடு) |

Technical terms printed on equipment (OLT, FAT, ONT, PON, SC/APC, OM3, Cat6) stay in English on
purpose. `i18n.test.ts` checks that every key has all five languages with the same placeholders.

## On-screen guide lessons (Guide button on the map)

The steps of the two guides, "Tour of every page" (`menu.*`, 18 steps) and "Map the network step by step" (`map.*`, 35 steps), are lesson scripts in `packages/shared/src/domain/voiceLessons.ts`. Their Telugu and Kannada words are drafts (`reviewed: false`). Since 12 November 2026 the server's automatic voice (`/voice/speak`) also speaks these drafts in Telugu and Kannada, so a native speaker should check both the words and the voice before field staff rely on them. Button names are kept in English inside the Telugu and Kannada words because the screen shows them in English; check with crews whether that is understood.