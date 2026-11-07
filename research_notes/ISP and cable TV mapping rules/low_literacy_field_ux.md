# Low-Literacy Field Data-Capture and Mapping UX (India: Karnataka, Telangana, Andhra Pradesh; Kannada, Telugu, Hindi, English)

Researched November 2026. Strength labels: **Strong** = quantified and consistent across more than one study or setting. **Moderate** = one solid study, or several weak ones agreeing. **Weak** = small n, qualitative, practitioner opinion or vendor source. **None** = no direct evidence found, so the guidance is inference.

Reading depth varies, and each entry says which applies:
- **Read directly (key sections of the extracted PDF text, not every page):** Medhi et al. 2011 (TOCHI), Medhi et al. 2007 (ITID), Findlater et al. 2009, Skarlatidou et al. 2019. First-party documentation pages (W3C, Android, MDN, ODK, Readium) were also read directly unless marked otherwise. Per-subject tables in Medhi et al. 2007 were garbled in extraction, so only its prose results are used.
- **Read from the abstract or a landing page:** marked "abstract".
- **Seen only as a search snippet:** marked "snippet". Verify these before quoting them.

Most core low-literacy studies date from 2007 to 2013 and used feature phones, PDAs or PCs. I found no replication on current touch smartphones in Karnataka, Telangana or Andhra Pradesh. Treat their scrolling and soft-key results as hypotheses to re-test, not as settled facts about today's users.

## Evidence on low-literate UI: text-free, audio, icons, hierarchy, scrolling, numeracy

### Takeaway
Text-only interfaces fail for non-literate first-time users, and hierarchy causes trouble even with no text on screen (**Strong** on both). Audio plus simple graphics helps, but illiterate and semiliterate users have different needs, and richer media does not reliably mean better comprehension (**Moderate**). Digits are the most dependable text channel, yet numeric entry is still a major source of errors (**Moderate**).

### Cited Findings

**Text versus non-text**
- In Bangalore, 58 non-literate and semiliterate first-time users attempted a mobile banking task. Text UI: 0/20 completed. Voice UI: 13/18 (72%), mean 5.2 min, about 4 prompts. Graphical UI: 20/20 (100%), mean 13 min, about 14 prompts. — [Medhi et al. 2011, TOCHI](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Voice completion differed by gender: 6/10 women and 7/8 men. Women took about twice as long on the task. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- The authors attribute the slow graphical UI partly to users being nervous that they might "break" or "spoil" the phone, so they needed prompting to press anything. They attribute voice failures to missing domain concepts that an automated system could not teach. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- The text-free job-search and map prototypes rested on more than 180 hours with more than 80 people in three Bangalore slums. Formal tests were tiny: 4 individuals plus 2 groups of 5 for job search, and 3 individuals for the map. The authors say the numbers do not reach statistical significance. No individual or group could navigate the text-based versions. — [Medhi, Sagar & Toyama 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf)

**Illiterate versus semiliterate**
- Two Kannada studies in Karnataka, the closest regional evidence found. In Study 1, 12 semiliterate participants cut task time from 476.7 s to 264.6 s and errors from 7.4 to 2.8 per block within 1.5 hours, while audio use fell. Nine of 12 preferred sound plus text and 3 preferred sound only. Even low-audio users wanted audio kept because it gave confidence. — [Findlater, Balakrishnan & Toyama 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)
- Study 2 (4 illiterate, 4 semiliterate, 4 literate-in-another-language, over 4 days): semiliterate and literate groups improved word recognition and illiterate participants did not (about 0.9 words per day). The authors conclude that adding audio to a text UI "can significantly support semiliterate users and should be easier than creating a new, text-free one". — [Findlater et al. 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)
- The same paper cites an old estimate that 75-80% of India's "literate" population may be only semiliterate. That is a secondary figure, so use it only as a warning that census literacy overstates reading ability. — [Findlater et al. 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)
- Recent state literacy figures come from weak secondary reports of PLFS 2023-24: Karnataka about 82.7% ([GKToday](https://www.gktoday.in/question/what-is-karnatakas-literacy-rate-rank-among-indian-states-per-plfs-202-772954)); rural Telangana 69.9%, with rural women 61.1% ([Telangana Today](https://telanganatoday.com/rural-literacy-rate-plunges-in-telangana-stands-second-from-bottom-among-all-states)); Andhra Pradesh about 72.6%, reported as lowest among states ([The South First opinion piece](https://thesouthfirst.com/opinion/andhra-pradesh-dreams-of-ai-while-millions-cannot-read/)). Snippets only; check against MoSPI.

**Audio and representation**
- A study of 200 illiterate subjects, 13 health symptoms and 10 representations (text, drawings, photos, animation, video, each with and without voice) found that richer media did not reliably improve comprehension, voice generally sped it up, and combined audio and visual input could confuse. — [Medhi, Prasad & Toyama, WWW 2007](https://www2007.cpsc.ucalgary.ca/program/paper.php?id=764) (abstract). Findlater et al. add a caveat: some of the audio accuracy benefit may be users mimicking the audio rather than understanding it. — [Findlater et al. 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)
- First-time users reacted very positively to voice in their own language. A consistent help feature cut task time and acted as a "constant source of reassurance". The map, which lacked overall help, needed more researcher prompting. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf)
- Google's Next Billion Users team recommends large voice icons reachable in one tap, read-outs broken into short sentences, and support for pauses and language switching. This is first-party practitioner guidance, not a controlled study. — [Google 2021](https://blog.google/technology/next-billion-users/voice-users-playbook/)

**Icons**
- Icons are read literally, with these specific failures: arrows for traffic direction failed until replaced by small car icons; yellow-highlighted roads were rejected because "roads can never be yellow"; a "house" icon read as a village hut; a tick and cross matrix failed; objects read as places unless action cues were added (water from a tap, steam from a kettle). Generic icons worked for "hospital", but specific instances needed photos. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf)
- In Congo Basin fieldwork, symbolic category metaphors failed even when they came from participatory workshops, and object icons needed action to be understood. — [Vitos et al. 2017, as summarised by Skarlatidou et al. 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf)
- Dimagi advises using a local illustrator, making each image unique and testing images first. — [Dimagi, Designing for Low-Literate Users](https://dimagi.atlassian.net/wiki/x/-jPKfw) (snippet; the page did not render for me)

**Hierarchy, scrolling and soft keys**
- Across 90 subjects in India, Kenya, the Philippines and South Africa: 56 could not initially navigate hierarchical menus. That included all 40 non-users of phones; 16 of 50 phone users could navigate. Of 34 who managed on their own handset, 23 failed on a different handset. Users dialled numbers from scratch instead of using call logs. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Vertical scrollbars were not understood by 48/90, who did not realise functions lay "beneath" the visible area. 45 had soft-key difficulty. The authors do **not** separate low literacy from technology inexperience. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- With 60 low-income Indian participants, literacy scores and Raven's Progressive Matrices both predicted hierarchy navigation performance **even in a UI with no text**. — [Medhi et al., CHI 2013](https://www.microsoft.com/en-us/research/?p=164235) (abstract). I could not retrieve the paper's specific breadth and depth recommendations.
- Thirteen low-literate UK adults (mean age 70.9) compared four data-collection UIs. A flat icon grid scored highest on task success, and the hierarchical Sapelli lowest even with only two top-level categories. The icon grid had the most errors, but users recovered easily, which the authors read as hierarchy making error recovery harder. A linear swipe menu was the least liked (8/13). — [Skarlatidou et al. 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf)
- Exposure helps: experience gradually moves low-literate users towards literate proficiency. — [Skarlatidou et al. 2019, citing Medhi et al. 2010](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf)

**Numeracy**
- Subjects typed digits comfortably but could not locate `*` and `#`. Almost all could identify numbers on receipts even when they could not read the text, yet receipts showing several transactions still confused them. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Half of observed errors were in the 3 numeric fields out of 12 questions. Causes: tactile key errors, trouble correcting with backspace, and decimals ("1006" for 100.6). — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Do not assume users can read a 24-hour clock or calculate time spans. — [Blue Ventures ODK guide](https://blueventures.org/wp-content/uploads/2021/03/Using-ODK-Guide_Setting-up-mobile-monitoring-1.3-August-2017.pdf) (snippet)

**Beyond reading**
- Ethnographic and usability work with 400 participants in India, the Philippines and South Africa argues that barriers also include cognitive difficulty, intimidation, mediation, power relations, social standing, motivation and experience. — [Medhi Thies, Cutrell & Toyama 2010](https://www.microsoft.com/en-us/research/?p=160560) (abstract)

### Inferences
- **Segment users.** Use text plus an icon plus an always-available speaker button as the default (the semiliterate majority), and keep every core task completable without reading (the illiterate minority). Do not ship a separate "illiterate mode": users may not choose it, and a separate mode doubles the test burden.
- **Flatten navigation.** Show a home screen of about 4-6 large task tiles, one level of choice at a time and no nested menus. Do not assume Sapelli-style decision trees are safe just because they use icons.
- **Do not hide things below the fold.** Keep critical actions visible without scrolling, and show a visible cue when more exists. Note that the swipe result came from elderly UK users and that the scrollbar data predates touch phones, so test this rather than assume it.
- **Replace typing with selection.** Where numbers are unavoidable, use a big digit pad, auto-format decimals and units, and read the value back aloud. Avoid symbols.
- **Draw icons in the worker's own visual world.** Use photos of actual local hardware, such as this operator's splitter box, for specific equipment. Cartoons with action cues suit verbs.

### Gaps
- No modern touch-smartphone replication of the Medhi hierarchy and scrolling results, and none specifically in Telugu or Kannada, beyond Findlater's Kannada study.
- No evidence comparing text plus icon with icon only on a current data-capture task in India.
- No specific evidence from Nokia-era low-literacy work turned up in these searches.
- Whether regular smartphone users today (WhatsApp, YouTube) still show these barriers is unmeasured, and it could change the priorities significantly.

## Map literacy: how novices understand maps and satellite view, and what helps them locate themselves

### Takeaway
India-focused evidence strongly supports landmark-based wayfinding over street names, compass directions and addresses (**Moderate**, consistent but mostly qualitative). I found **no study** testing how low-literate Indian users understand satellite imagery or locate themselves on a map. Any claim that satellite is easier for them is unproven, and general research warns that people prefer realistic displays even when these hurt performance (**Weak** for this audience).

### Cited Findings
- Slum residents in Bangalore relied primarily on landmarks, not north-south-east-west directions, addresses or street names. Maps were not common artefacts for them, even though geography mattered daily. The text-free map used landmarks heavily, with photos of specific ones. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf) (3 formal map participants plus design fieldwork)
- None of the participants could locate important landmarks on a commercial text-based map. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf)
- A study of delivery personnel, drivers and repair technicians describes India as "not a very map-savvy culture", with wayfinding done by asking about landmarks en route. Even online-map users checked major landmarks before setting out. Hand-drawn routes drew high-speed road sections straighter than low-speed ones, and users construed a route without turns as a straight road. — [Springer LNCS 978-3-319-22668-2_40](https://rd.springer.com/chapter/10.1007/978-3-319-22668-2_40) (snippet; paywalled, and I could not confirm title, authors or sample)
- A first-person practitioner account of Google Maps in India: streets were often unnamed, had several names or were known unofficially. Field methods included calling shops for directions, asking people to draw routes, following them, and logging directions. Landmarks served four functions: orientation, describing a turn, confirming the path, and correcting errors. Useful landmarks were parks, monuments, shops, petrol stations and roundabouts. — [Laraki 2024](https://elizlaraki.substack.com/p/google-maps-ux-the-india-conundrum)
- Naive realism: people prefer more realistic displays and do not notice when realism harms task performance. — [Smallman & St. John, summarised in ICA Proceedings 2018](https://ica-proc.copernicus.org/articles/1/20/2018/ica-proc-1-20-2018.pdf). Extraneous map detail slowed responses and increased errors in lab tasks, yet participants still chose such maps a substantial share of the time. — [Hegarty 2013 summary](https://www.bohrium.com/paper-details/cognition-metacognition-and-the-design-of-maps/813255123353468928-10126) (snippet). Lab studies, not India, not low literacy.
- Indian public programmes already pair satellite-georeferenced records with field apps, showing feasibility at scale but not comprehension. The Bhuvan apps overlay field attributes and photos on satellite data and store them for upload when offline. — [NRSC Bhuvan manual](https://bhuvan-app1.nrsc.gov.in/pmjvk/manuals/BhuvanPMJVK_Mobile_Manual.pdf) (snippet). MGNREGA attendance requires geo-tagged, time-stamped photos twice daily, within 10 m of the stored coordinates. — [India Education Diary 2024](https://indiaeducationdiary.in/?p=545870) (news reprint)

### Inferences
- **Automate "where am I".** Open centred on the GPS location with a large "you are here" marker, show distance and a simple arrow towards the target, and never ask a worker to find themselves by scanning the map.
- **Rely on the phone's position rather than map reading for capture.** Stand at the asset, tap "I am at this pole", and let GPS place it. Offer manual drag only as a correction, ideally with a supervisor reviewing the change.
- **Label the map with what workers already name:** temple, school, petrol bunk, the customer's shop, plus photos taken earlier at nearby assets. Add a worker-recorded voice note such as "near the temple" as a location aid, because an address will not do this job.
- **Treat satellite as an A/B test,** not a default assumption. Provide one simple street-style base, a one-tap toggle, and measure location-finding on each. Literal reading suggests colour matters too: keep roads and cables in plausible colours, use one colour per concept, and avoid cartographic legends.
- **Provide route instructions as landmark-keyed audio and step cards,** not north/south. A "turn at the temple" prompt requires landmark data, so have field workers build it up during capture.

### Gaps
- No direct study of satellite versus map comprehension among low-literate users in India, and no study of self-location performance on a touch map in this audience.
- No peer-reviewed study found of map problems among GeoMGNREGA or NMMS field users. Parliament and programme documents discuss the scheme but not map reading.
- No retrievable data on rotation, north-up versus heading-up, or zoom comprehension for this group. Test heading-up as a hypothesis.

## Field tools for this audience: ODK, CommCare, Sapelli, ASHA apps, wizards, photo-first and QR

### Takeaway
Scanning a pre-printed code is the best-supported way to reduce text entry (**Moderate**: CAM at 1% or below). Tangible and flat-choice interfaces also outperform trees in small studies (**Moderate**, small n). I found no controlled test of one-question-per-screen, so it is a sensible default supported only indirectly (**Weak**). Even trained literate workers on ordinary forms produce enough errors to matter (**Moderate**, n=13, simulated).

### Cited Findings

**Baseline error rates**
- Thirteen literate health workers and hospital staff in Gujarat entered simulated patient data, after training until two perfect trials, on forms (4.2% per entry), SMS (4.5%) and a live operator (0.45%). Health workers on forms: 7.6%. Hospital staff on forms: 1.3%. The authors estimated 38% of submitted forms could contain an error. — [Medhi et al. 2011 reporting Patnaik et al. 2009](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- 12 of 26 total errors were dangerous and only one of those was detectable from the data. Multiple-choice errors on forms pass validation because every entry looks valid. Entry time: forms 1:39, SMS 1:37, operator 2:20. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Preference diverged from accuracy: only 1 of 13 preferred the most accurate interface, although bad call quality was a confound. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- The live-operator option has real force for rare complex cases: this team moved their TB programme off forms entirely on the strength of these results. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)

**Codes, cards and photos**
- CAM annotated each paper field with a barcode read by the phone camera. Users with no prior camera or computer experience reached comfort in 5-15 minutes, with error rates of 1% or below reported. — [CAM, as summarised in Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf); [Parikh et al. CHI 2006](https://researchr.org/publication/ParikhJSGT06)
- Tap&Map used NFC cards to tag an object with GPS and reached 97.5% task success in the Congo Basin fieldwork, described as "faster, easier and more comfortable" than the Sapelli tree. In the UK comparison, it had the lowest error rate (2%), and 10/13 preferred it. Dexterity problems affected participants with arthritis. — [Skarlatidou et al. 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf)
- Geo-tagged, time-stamped photos are already a national-scale requirement in MGNREGA. This shows precedent and familiarity for some workers, not that photo-first capture is more accurate. — [India Education Diary 2024](https://indiaeducationdiary.in/?p=545870)
- For browser-based scanning, the BarcodeDetector API has "limited availability" and is experimental, requiring a secure context. — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)

**Platform patterns**
- ODK Collect supports choice grids with images (`columns`, `no-buttons`), auto-advance on single selection (`quick`), camera-only photos (`new`), auto-capture of a point once GPS reaches `capture-accuracy` (default 5 m), and a red dialog at `warning-accuracy` (default 100 m, not enforced). Long-pressing a `placement-map` point records accuracy and altitude as 0. — [ODK question types](https://docs.getodk.org/form-question-types/)
- ODK offline maps use MBTiles; online basemaps show only when connected, so a basemap must be included in the offline file for offline fieldwork. Broader zoom ranges make files bigger. — [ODK offline maps](https://docs.getodk.org/collect-offline-maps/)
- Dimagi's low-literacy guidance: favour single-select and numeric questions, split long lists, keep case lists very short, use a number as identifier where the user is numerate, validate audio scripts with field staff, avoid laptop microphones. Sense Mode simplifies the experience and disables saving incomplete forms, which had caused confusion and lost work. It also notes that many illiterate workers are excellent counsellors, so build on their strengths. — [Dimagi](https://dimagi.atlassian.net/wiki/x/-jPKfw) (snippet; community wiki, may be dated)
- "Use icons and audio to guide users", minimise text input, and make validation messages say what to do. — [Dimagi App Design module](https://dimagi.atlassian.net/wiki/spaces/commcarepublic/pages/2143946206/Learning+Module+App+Design)
- Sapelli was built because ODK's XForms made hierarchical flows verbose, and it targets non-literate users with little ICT experience. — [ExCiteS Sapelli](https://github.com/ExCiteS/Sapelli) (snippet)

**India health-worker apps**
- PIERS on the Move in Karnataka, with 48 ASHAs and ANMs (24 users, 24 controls), found the app easy to use with training, even with limited smartphone experience. Knowledge and self-efficacy scores did not differ between groups. Users reported better interactions with families. — [Charanthimath et al. 2021](https://public-pages-files-2025.frontiersin.org/journals/global-womens-health/articles/10.3389/fgwh.2021.645690/text) (abstract)
- Fifteen CommCare workers in Bihar: quality scores were 33.4% higher among high users, and literacy and age affected adoption and how the tool was used. The sample is small, and direction of causality is unclear. — [JMIR mHealth 2015](https://doaj.org/article/86e51c3752ef4fe1828b7f4ddadb699f) (snippet)
- M-SAKHI (Maharashtra) was CommCare-based with an evaluation nested in a cluster RCT, but its usability was measured on a 3-point Likert scale, which is vulnerable to response bias. — [M-SAKHI evaluation](https://chwcentral.org/wp-content/uploads/Evaluation-of-Impact-of-the-M-SAKHI-mHealth-App-on-Knowledge-Skills-and-Acceptance-of-use-of-App-by-Maternal-and-Child-Health-Community-Health-Workers-in-Rural-Maharashtra.pdf) (snippet)

### Inferences
**Recommended capture pattern for an asset such as a pole, box or customer drop:**
1. The worker taps a big tile, with spoken instruction, for "Add box".
2. Camera opens first, with a photo overlay showing what to frame and a short spoken instruction.
3. GPS is captured automatically, with a progress indicator and audio. No coordinates are shown.
4. The worker scans the QR on a pre-printed tag where one exists.
5. The worker makes one or two single-choice selections from photo grids, with auto-advance.
6. A summary card shows photo, icon and place, read aloud, with a large Save and a "fix" control.

This is about 5 taps for the common case, and it can be implemented as a wizard with no back-end hierarchy.

- **Prefer pre-printed QR labels on hardware, or cards from a pack for component types.** The CAM and Tap&Map results suggest that code or token selection moves the burden away from reading. Offer manual fallback and test on dirty or weathered labels, because the studies did not cover these conditions.
- **Do not depend solely on BarcodeDetector in a web app.** Bundle a JavaScript or WASM scanner library, or use a native wrapper. Check it on the target devices.
- **Treat the live operator as a fallback.** Provide a one-tap call to a supervisor or voice-note escape for odd cases, so that workers do not guess wrongly.
- **Require evidence for wrong-selection errors.** Choice errors pass validation (the Patnaik result), so photos allow later audit and correction. Spot-audit a sample rather than trusting clean validation.
- **Distinguish GPS accuracy from correctness.** Show a simple "wait, finding your position" state and a red warning. Unlike ODK's default, consider blocking save at poor accuracy with a logged override, because a misplaced asset is costly. The 100 m default is too lax for network mapping, where assets may be metres apart.

### Gaps
- No controlled comparison of one-question-per-screen with multi-field screens found. No specific published evidence on camera-instruction design, or on low-literate users framing asset photos.
- No retrievable ArcGIS Field Maps low-literacy evidence. I did not find a useful first-party source for it in this research.
- Google's Next Billion Users output I could retrieve covered voice only, not a general low-literacy pattern library.
- Android-specific Google low-literacy documentation was not found.
- No evidence comparing QR, NFC and photo recognition in this specific population.

## Error handling and trust: undo vs confirm, plain errors, validation, offline status

### Takeaway
Fear of damaging the phone and difficulty recovering from errors are documented barriers (**Moderate**). General HCI practice strongly favours undo over frequent confirmation, but I found **no empirical study** testing undo, plain-language errors or sync indicators with low-literate field workers (**None** directly). Treat what follows as reasoned design to be tested.

### Cited Findings
- Users were nervous that they could "break" or "spoil" the phone and needed prompting to press keys. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Fear of technology and touchscreen difficulties, including rough skin and confusion over tapping and long presses, were observed in Congo Basin fieldwork. — [Vitos et al. 2017, in Skarlatidou et al. 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf)
- Users showed trouble using backspace even after demonstration. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Error recovery is harder deep in trees than in flat lists; the flat icon menu had the highest error rate yet the highest task success, because users recovered. An illiterate first-time smartphone participant said Tap&Map gave confidence that "I am not as thick as I think I am". — [Skarlatidou et al. 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf) (UK, n=13, older adults)
- Over one-third of errors were detectable from data alone (out-of-range numbers, invalid codes) and could be flagged automatically. Choice errors were not. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- General HCI guidance: use confirmations sparingly and for serious, irreversible actions; prefer undo because it reduces anxiety; frequent warnings cause habituation; state the specific consequence; label buttons with outcomes rather than Yes/No. — [Nielsen Norman Group](https://www.nngroup.com/articles/confirmation-dialog/) (not low-literacy-specific)
- Saving incomplete forms caused confusion and lost work among Dimagi's field staff, so Sense Mode disables it. — [Dimagi](https://dimagi.atlassian.net/wiki/x/-jPKfw) (snippet)
- Validation messages should be helpful and tell the user what to do. — [Dimagi App Design module](https://dimagi.atlassian.net/wiki/spaces/commcarepublic/pages/2143946206/Learning+Module+App+Design)
- Audio gave users confidence to confirm a choice before selecting it. — [Findlater et al. 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)

### Inferences
- **Default rule:** every field action is undoable, and the app says so aloud: "You cannot break anything. You can fix this later." Keep edit history on the server so a wrong entry never destroys prior data.
- **Reserve confirmation** for genuinely destructive or external actions, such as disconnecting a customer's record or marking a cable removed. Show the affected item's photo and consequence, read it aloud, and use outcome buttons with icons ("Remove this box" and "Keep"). Avoid red-versus-green-only meaning.
- **Express errors as next actions, with an image:** instead of "Invalid GPS accuracy", show the picture of a person moving outdoors and say "Go to open sky. Wait for the green tick." Log an error code for support, but do not show it as the main message.
- **Show what a mistake means** using real consequences: "Customer's line will show on the wrong pole."
- **Prevent rather than report:** auto-format, restrict ranges, use auto-capture, and compare new points against the expected network (for example, a box 2 km from its parent line prompts a check rather than a rejection). Use soft warnings with a logged override, so that work is never blocked by an incorrect rule.
- **Offline status** should be three states with fixed icon, colour and spoken phrase, for example "Saved on phone", "Sending", "Sent to office". Count items as digits. Save every step locally so that a dead battery or dropped signal loses nothing. Never show a spinner with no explanation, or a failure that blames the worker.
- **Add positive confirmation** after every save, using sound, vibration and a tick, since a silent success may make anxious users repeat an entry. Handle duplicates with idempotent submission. Sound may be unusable in noisy places, so vibration and a visual state should not depend on it.

### Gaps
- No empirical data on undo versus confirm, error wording, or sync indicators among low-literate users. I searched specifically and found mainly vendor blogs, which I excluded.
- Whether workers trust an "offline saved" state, and whether they would re-enter data out of doubt, should be measured in field testing.

## Accessibility requirements: touch targets, sunlight, one-handed use, gloves, Indian-script type

### Takeaway
Treat the platform minimums (WCAG 24 CSS px, Android 48dp) as a floor, not a target (**Strong** that they are minimums). Field conditions justify about 64-72dp for frequent actions, but no study establishes a low-literate or Indian-field number (**Moderate**, by extrapolation). Telugu and Kannada need more line-height than Latin, and I found no first-party numeric values for them (**Weak**). I found no rigorous dark-versus-light study for phones in direct sun (**None**).

### Cited Findings

**Target size**
- WCAG 2.2 SC 2.5.8 (AA) requires 24 by 24 CSS px, with exceptions. SC 2.5.5 Enhanced sets 44 by 44 CSS px, and W3C suggests aiming for this size on important controls. — [W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Android recommends a touch target of at least 48dp by 48dp, adding "Larger is even better". — [Android Developers](https://developer.android.com/guide/topics/ui/accessibility/apps)
- W3C's research summary: 45 by 45 CSS px rendered at roughly 7-9.5 mm across devices. Kiosk research put 20 mm as an optimal compromise, 10 mm gave the most inaccurate touches, non-disabled users plateaued at 20 mm, and people with motor impairments kept improving up to 30 mm. Kiosk results do not transfer directly to handheld phones. — [W3C Mobile A11y TF](https://www.w3.org/WAI/GL/mobile-a11y-tf/wiki/Summary_of_Research_on_Touch/Pointer_Target_Size)
- Studies of one-handed thumb use found 9.2 mm for discrete tasks and 9.6 mm for serial tasks sufficient. — [Parhi, Karlson & Bederson, HCIL 2006-11](https://www.cs.umd.edu/hcil/trs/2006-11/2006-11.htm) (snippet)
- Gloves: a military study (n=6) found gloves reduced first-try accuracy, with no errors in the MIL-STD-1472 size condition. Reported MIL-STD sizes: 15 mm square bare hand, 20 mm gloved, 3 mm separation. — [Touch Zone Sizing study record](https://katalog.lib.cas.cz/KNAV/EdsRecord/edsair,edsair.doi...........9465c900e5780072de7a168d106fd14d) (snippet; standard figures not checked against MIL-STD text)

**Contrast and sunlight**
- Android: 4.5:1 for text below 18sp (or bold below 14sp), otherwise 3:1. — [Android Developers](https://developer.android.com/guide/topics/ui/accessibility/apps). WCAG 1.4.6 (AAA): 7:1 and 4.5:1 for large text. It targets low vision, and does **not** address glare or outdoor viewing. It also warns that thin fonts can appear fainter than their specified colours. — [W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)
- Phone screens behave like mirrors in bright light. — [DisplayMate](https://displaymate.com/Smartphone_Brightness_ShootOut_1.htm). DXOMARK's protocol tests displays up to about 50,000 lux. — [DXOMARK](https://dxomark.com/a-closer-look-at-the-dxomark-display-protocol). A patent reports contrast below 1.75 under sun on one LCD phone. — [US 7853288](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7853288). All three are engineering or commercial sources, not user studies. The only explicit dark-mode recommendation I found came from a vendor piece with no visible method, which I discount.

**Grip**
- In Hoober's 2013 field observation (1,333 observations; 780 touching the screen), about 49% used one hand and thumb, about 36% cradled, about 15% used two hands. People switched grip often. — [UXmatters](https://uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) (figures from secondary coverage). A secondary source says Hoober has since criticised the popular chart. — [Monterail](https://www.monterail.com/blog/thumb-friendly-navigation-word-oriented-design) (unverified). Not India, not field work.

**Fonts and script**
- Government of India UX4G: Noto Sans for product UI, body at least 16px, use rem units, line height of **1.8 for Devanagari**, and at least 1.5 generally (WCAG 1.4.12). — [UX4G](https://www.ux4g.gov.in/foundations/typography). It specifies Hindi and English; I saw nothing Telugu- or Kannada-specific.
- Noto Sans Telugu and Noto Sans Kannada exist as open-licence web fonts. — [Fontsource](https://fontsource.org/fonts/noto-sans-telugu/about); [Adobe Fonts](https://fonts.adobe.com/fonts/noto-sans-kannada)
- Material Design lists Telugu among "tall" scripts requiring extra line height. — [Material 2](https://m2.material.io/design/typography/language-support.html) (snippet; the page did not render for me)
- A web typography guide suggests setting base font size at 100%, and notes dense scripts need larger size and line spacing. Malayalam stacking needs a careful line-height ratio to avoid clipping. — [Thottingal](https://docs.thottingal.in/web-typography) (snippet; individual practitioner)

### Inferences
Physical conversion, computed here: 48dp is about 7.6 mm, 64dp about 10.2 mm, 72dp about 11.4 mm, and 20 mm about 126dp. A 360dp-wide phone is about 57 mm across.
- **Sizes:** minimum 48dp with 8dp spacing for anything; 64-72dp for routine controls; full-width bottom buttons at least 72dp tall for primary actions. For gloves or heavy-work contexts, offer a mode with 2-column tiles at about 126dp, which fits two across on a narrow phone. Rough skin and capacitive failures on calloused or wet fingers are a field risk, so test with the people who will actually use it.
- **Avoid long-press, drag, pinch and small swipes for essential tasks.** Provide + and − map buttons and tap alternatives.
- **Position:** put primary actions in the bottom third, with navigation-free single-step screens. Do not rely on one-handed zones alone, since grip changes and workers may be holding tools or standing on a ladder. Support resuming after interruption.
- **Contrast:** use 7:1 for text and 4.5:1 for icons as a working margin, even though the standard was not written for sunlight. Do not encode meaning in colour alone; pair each state with a shape or icon. Prefer solid dark text and heavy icons on a light surface as the default hypothesis, and test light and dark on real low-cost LCDs in midday sun. Keep brightness guidance in training. Avoid thin weights.
- **Type:** starting values to test, not validated figures: Kannada and Telugu body 18sp, weight 500, line-height 1.7-1.8; Devanagari body 18sp, line-height 1.8; Latin body 16-18sp, line-height 1.5. Use `rem`, respect system font scaling, never fix button heights so that text clips, and check conjuncts such as Kannada ottus and Telugu vattus at the smallest size and largest scale.
- **Fonts:** self-host subsetted Noto WOFF2 for offline use via service worker. Do not rely on system fonts on low-end Android, though these usually have Noto coverage. Set `lang` on each element for shaping and for assistive technology. Check for tofu and wrong shaping on real devices, including older Android versions.

### Gaps
- Apple's page did not render in my tool. The 44 by 44pt minimum is widely cited and matches W3C's 44 CSS px enhanced level, but I did not verify the wording directly against Apple's current HIG.
- No empirical line-height or minimum-size figures for Telugu or Kannada on phones from a first-party or peer-reviewed source. A search snippet from a type designer's notes suggested 1.5 line spacing for even Kannada texture, but I could not open it to confirm source or context.
- No published study of bare-hand, gloved, wet or calloused touch for Indian field workers; no outdoor polarity study; no data on the target device mix.

## Translation and speech: loanwords, literal translation, i18n pitfalls, Web Speech for Telugu and Kannada

### Takeaway
Literal translation frequently fails for technical terms, and conversational wording is preferred (**Moderate**, including first-party Google and ODK guidance). Loanwords are often clearer, but not automatically: evidence conflicts and depends on the word (**Weak**, no controlled study for Telugu or Kannada). Do not rely on `speechSynthesis` for Telugu or Kannada: voices are not guaranteed, it can silently fall back to English on Android, and it is missing from Android WebView (**Moderate to Strong** on technical behaviour). Ship recorded audio.

### Cited Findings

**Translation**
- "Jaundice" did not translate well into Hindi and was sometimes more recognisable in English. "View last transaction" and "Get balance" were alien concepts without explanation, even in the local language. Translation cannot fix an unfamiliar concept. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- ODK: "Oftentimes, a literal translation is not the best way to get the right data." Test with native-speaking local experts and data collectors, and observe fieldworkers. — [ODK multilingual forms](https://docs.getodk.org/guide-form-language/)
- Google research reported that direct translations may not be easily understood by most Indian-language speakers; conversational phrasing beat formal translation for Hindi, and it warned against romanising Indian-language words, since users may understand a spoken word but not its Roman spelling. — [Think with Google](https://www.thinkwithgoogle.com/intl/en-apac/future-of-marketing/creativity/app-website-localization-indian-users) (snippet; URL now redirects, so I could not read the page)
- Non-fluent avid smartphone users in India often chose English proactively, a choice bound up with identity and mobility. — [Karusala et al. 2018](https://redi.cedia.edu.ec/document/1644) (abstract). A UI that is only in the regional language can therefore be an unwelcome choice for some, and a language picker should not be treated as a literacy test.

**Conflicting evidence on loanwords**
- A Hindi-focused document reports English replacements such as "scan" and "update" that users sometimes did not understand, and that users preferred everyday conversational language. — [Bhashik document](https://cdn.jsdelivr.net/gh/amanunparallel/privacyforbharat@main/BHASHIK%20.pdf) (snippet; provenance unclear)
- A 2009 heuristic evaluation **recommended translating** English technical terms into Hindi. — [Orngreen et al., IFIP 2009](https://dl.ifip.org/index.html/db/conf/ifip13/hwid2009/OrngreenKS09.pdf) (snippet). This was a heuristic evaluation, not a comparative user test.
- A vendor write-up reports Hinglish preferred over formal Hindi. — [Parallel HQ](https://parallelhq.com/bharat-insights/digital-payments/can-language-bridge-the-mistrust-barrier). Discount its "100%" figure: small commercial sample.
- Telugu localisers argued against invented terms for words like "internet" and "offline". — [ubuntu-l10n-te list](https://archive.lists.launchpad.net/ubuntu-l10n-te/msg00083.html) (community opinion). A Kannada glossary method chooses among coining, translating and transliterating case by case, and notes the lack of a UI-string standard. — [CIS India](https://cis-india.org/a2k/blogs/pavanaja.com-english-fuel-gilt-kannada-tulu). India's terminology commission notes some terms need no translation. — [Careers360 on CSTT](https://news.careers360.com/cstt-aicte-btech-engineering-technical-term-hindi-regional-language-ncert-isro-barc-ai-school-textbook-education-ministry/amp) (news)

**i18n mechanics**
- ODK pitfalls: blank language cells stay blank rather than falling back; media needs a per-language column; do not translate variables or formatting; machine translation is only a first draft; test every language. — [ODK](https://docs.getodk.org/guide-form-language/)

**Web Speech**
- Chrome on Android "doesn't return the list of voices available to the users" but an unfiltered list of languages and regions. If a voice pack is missing, "Chrome will default to an English voice instead". Users may need to go deep in settings to download, and to select a default voice per region. — [Readium Speech notes](https://readium.org/speech/docs/WebSpeech.html)
- The voice list depends on device, OS and browser, and may be empty on first call, so wait for `voiceschanged`. — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)
- Kannada, Telugu and Hindi are Google Text-to-Speech languages supported by TalkBack, but "some devices may not support all languages in all regions". — [Google Support](https://support.google.com/accessibility/android/answer/11101402?hl=en)
- Android WebView does not support the Web Speech API. — [Chromium blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/XpkevOngqUs). This was still reported on Chromium 138 WebView. — [Xibo forum](https://community.xibo.org.uk/t/android-player-speechsynthesis-web-speech-api-unavailable-in-webview-chromium-138/38219) (user report)
- Chromium proposed blocking `speak()` without user activation, in line with autoplay rules. — [Chromium blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/XpkevOngqUs) (a proposal from around Chrome M69-71; I did not verify current behaviour)
- Desktop Chrome has a limited online-only voice set; Edge has many voices but they need connectivity. — [Readium](https://readium.org/speech/docs/WebSpeech.html). No offline guarantee, so desktop results say little about field phones.
- Azure lists neural voices for Kannada (Gagan, Sapna) and Telugu (Shruti, Mohan), per 2020 announcements. — [Microsoft](https://techcommunity.microsoft.com/t5/azure-ai/ignite-neural-tts-updates-new-language-support-more-voices/ba-p/1698544); [Microsoft](https://techcommunity.microsoft.com/t5/azure-ai/azure-neural-text-to-speech-updates-51-new-voices-added-to-the/ba-p/1988418). Check current availability.
- Audio files must be validated with field staff and recorded with a proper microphone. — [Dimagi](https://dimagi.atlassian.net/wiki/x/-jPKfw) (snippet)

### Inferences
**Term selection rule:** test the word workers actually say, not the dictionary. Build a glossary by recording real conversations with crews in each region, then run a recognition test.

Candidate strings to test (author-generated and **not from a source**; a native speaker and field crew must validate them):

| Concept | Kannada loanword | Telugu loanword | Hindi loanword | Native alternative to test |
|---|---|---|---|---|
| Box | ಬಾಕ್ಸ್ | బాక్స్ | बॉक्स | Usually loanword |
| Pole | ಪೋಲ್ | పోల్ | पोल | ಕಂಬ / స్తంభం / खंभा |
| Cable | ಕೇಬಲ್ | కేబుల్ | केबल | Usually loanword |
| Splitter | ಸ್ಪ್ಲಿಟರ್ | స్ప్లిటర్ | स्प्लिटर | Test with photo |
| OLT | Use photo, spoken "O-L-T" | Same | Same | Avoid expanding the acronym |

"Pole" shows why not to assume: an everyday native word may be just as familiar as the loanword, depending on region. **Do not transfer Telangana wording to coastal Andhra or between Karnataka regions without checking.**

- **Write loanwords in the local script by default,** reflecting Google's romanisation warning, with an English toggle available for users like those in Karusala's study. Include photos beside each term, because the concept may still be unknown.
- **Audio strategy:**
  1. Primary: human-recorded clips of fixed prompts in Kannada, Telugu, Hindi and English, by a voice crews find natural, cached offline.
  2. For dynamic content such as names and numbers: splice pre-recorded digits and common words, or generate files ahead of time with cloud TTS and human review.
  3. Device `speechSynthesis` only as an opt-in enhancement, started by a tap, and only after a device-test confirms that a real local voice actually played. On Android, a listed voice does not prove the pack is installed, so a programmatic check is not enough.
  4. If shipped in a WebView wrapper, use a native TTS bridge, since `window.speechSynthesis` is unavailable.
- **Never let Telugu text be read by an English voice.** It is worse than silence. If a local voice cannot be confirmed, show the speaker icon only where a recording exists.
- **General i18n engineering practice (no specific source):** use message keys and ICU plural and gender handling, no concatenated sentences, no text baked into images, support for expansion and wrapping, and `lang` attributes. Store canonical data as stable codes, not localised strings, so that a Telugu entry and a Kannada report refer to the same asset type. Use Western digits by default, since evidence for digit recognition concerns those, and verify any native-digit assumption by region.

### Gaps
- No controlled study of translated versus transliterated UI terms in Telugu or Kannada. Hindi evidence is thin and conflicting.
- No telecom or cable-specific field vocabulary study found. The glossary must be collected from crews.
- Actual Telugu and Kannada offline voice availability on Android by OEM and version is undocumented in first-party sources I could access. Only testing on target devices settles this.
- No comparison found of comprehension of human recording versus TTS for low-literate Indian users.

## Training and rollout: learn-by-doing, demo mode, videos, buddies, and testing with low-literate users

### Takeaway
Training dose has a large effect on data quality (**Moderate**), and short task-focused sessions can change behaviour (**Weak to Moderate**). Human mediators remain part of successful systems (**Moderate**). For testing, observed task outcomes in real settings beat stated preference, because response bias is large and measured (**Strong** on bias). Evidence for demo mode and buddy systems specifically is absent.

### Cited Findings

**Training**
- Novices reached under 2% error given at least an hour of training on PDAs, against 14% with only 2-3 minutes; accuracy was higher among those with completed secondary schooling. — [Medhi et al. 2011 literature review](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- CAM users reached comfort in 5-15 minutes. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Training was confounded with worker type: health workers were trained in a large group for 6-8 hours, hospital staff in small groups for 1-2 hours. The groups differed widely in error rate, so long group training is not evidently better than short small-group training. Trainers also improved over time. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Human mediation "was critical for most successful transactions", and manuals went mostly unread. Recommendation 8 is to integrate human mediators to familiarise users with scenarios and UIs. — [Medhi et al. 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)
- Women in Chhattisgarh given free smartphones learned specific tasks in 45-minute sessions and used phones more often and for more tasks than those without training. — [Yale Inclusion Economics brief](https://ie.yale.edu/gender-and-growth-gaps-project/policy-briefs/accelerating-indian-womens-use-mobile-phones-through-low-cost-training-digital-skills-improves-their) (snippet; the page did not load, so design details are unverified). Not a field-work population.
- In the map and job study, groups were more confident than isolated individuals, advising each other and interacting more boldly. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf) (informal observation)

**Video**
- Over two months, short phone videos in rural India had preliminary positive effects on motivation and learning, and on engaging community members. Workers also recorded their own. — [Ramachandran et al., CHI 2010](https://www.microsoft.com/en-us/research/?p=159425) (abstract)
- Lesotho: health trainers made locally relevant mobile training videos, combining images, voice-over and clips, to supplement national materials. — [Molapo & Marsden, ICTD 2013](https://pubs.cs.uct.ac.za/id/eprint/898/) (snippet). 17-month log and interview work with first-time smartphone users. — [Molapo thesis record](https://open.uct.ac.za/items/cd006bb5-e643-4f58-aec1-d7464d1ea829) (snippet)

**Test methods**
- Response bias, 450 interviews in Bangalore: respondents were about 2.5 times more likely to prefer a technology they believed the interviewer built, about 5 times if the interviewer was a foreigner using a translator, and this held even with a deliberately degraded artefact. — [Dell et al., CHI 2012](https://www.microsoft.com/en-us/research/?p=162695) (abstract). Male participants only.
- Think-aloud with 20 rural teachers in Côte d'Ivoire needed culturally sensitive adaptation. — [arXiv 2501.05840](https://arxiv.org/html/2501.05840v1) (snippet). Classic concurrent think-aloud can under-report problems where there are power differences between participant and evaluator. — [Clemmensen, CBS](https://research-api.cbs.dk/ws/files/46753711/torkil_clemmensen_a_textual_feedback_tool_postprint.pdf) (snippet)
- Testing with oral, rural users often required forgoing traditional approaches for flexible, opportunistic methods. — [Gorman et al., CHI 2011](https://digitalcommons.tacoma.uw.edu/ias_pub/487) (abstract)
- US federal guidance recommends experienced moderators, fewer tasks, plain materials and extra time. Asking people what they would do next is a useful probe. — [ODPHP](https://odphp.health.gov/hlo/2016/test/full) (US context)
- Medhi's team switched from "find yourself a job" to "a friend needs a job" after one participant became agitated, and embedded tasks in stories. Single-subject tests made people nervous while group tests relaxed them. — [Medhi et al. 2007](https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf)
- Findlater assessed reading with a read-aloud sentence in Kannada and paid roughly a casual labourer's daily wage. Recruitment was hard because work schedules restricted availability. — [Findlater et al. 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf)
- If literacy varies, include varied users in piloting. Dimagi advises extensive user testing to find confusing language, media or workflows. — [Dimagi](https://dimagi.atlassian.net/wiki/x/-jPKfw) (snippet)
- Allow participants to handle devices before testing, as a pre-training step, per a chapter on low-literate rural Indian users. — [Springer 978-3-319-67684-5_1](https://link.springer.com/chapter/10.1007/978-3-319-67684-5_1) (snippet; title and authors not confirmed)

### Inferences
**Rollout sequence (proposed):**
1. **Foundation session,** 45-60 minutes in groups of 3-5, in the local language. Workers do tasks on their own phone, on real or practice assets, not watching slides. Start with "you cannot break it".
2. **Demo mode,** which is a practice workspace clearly marked with a distinct border and spoken reminder, using sample assets and never touching real data. No study tests this directly. It is a reasonable way to lower fear of consequences, and it should be measured. It should reset on demand.
3. **Short videos,** under 60-90 seconds, one task each, in local dialect and showing real local crew and hardware. Make them available offline in-app beside the task, using trained workers or trainers as presenters.
4. **Buddy period,** pairing a new worker with an experienced peer for a few days. Rotate pairs where possible, because "power relations" and "mediation" (Medhi et al. 2010) mean a buddy may also take over the phone and mask issues. Measure the solo rate after the buddy period ends.
5. **Graduation by performance:** adopt Patnaik-style "two consecutive perfect practice captures" as sign-off, rather than attendance alone. Remember that high training thresholds still gave 7.6% errors later, so sign-off does not eliminate the need for audit.
6. **Feedback and supervision:** review photos weekly, and send corrections as a picture or voice note rather than a text report. Respond to a mistake as coaching, because punishment would likely teach workers to hide errors or avoid the app.

**Usability test protocol:**
- Use a moderator from the same language community who is not presented as the builder, and say "someone else made this and wants to know what's wrong with it".
- Do not ask "do you like it?" as evidence. Measure whether people complete the task, and compare two anonymised variants if a preference is needed.
- Give the instruction verbally or with a picture card and show a physical target, such as "add this box". Prefer retrospective review of screen and hand video over concurrent think-aloud. Try group sessions for discovery and individual sessions for measurement.
- Log prompts by level: 0 none, 1 encouragement ("try"), 2 hint on the area, 3 show how. Completing only with a level 3 prompt counts as a failure.

### Gaps
- No direct evidence for demo or sandbox mode, video length, or a buddy system in field-data apps with low-literate workers.
- Pictorial task-instruction cards are widely used in practice, but I found no study validating them.
- No evidence on retention after several weeks, or on staff turnover.

## Measurable targets and running a practical field test

### Takeaway
No accepted benchmark exists for low-literate field capture. The targets below are **proposed starting points set by this research, not findings**. Set them from a baseline pilot and judge them with audit-based accuracy, since preference and self-report are unreliable (**Strong** for avoiding self-report; targets themselves are **unvalidated**).

### Cited Findings
**Reference points available:**

| Measure | Observed value | Context | Source |
|---|---|---|---|
| Text UI, first use | 0% completion (0/20) | Low-literate, Bangalore | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Graphical UI, first use | 100% (20/20), 13 min, about 14 prompts | Same | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Voice UI, first use | 72% (13/18), 5.2 min, about 4 prompts | Same | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Forms, trained users | 4.2% per entry; 7.6% health workers; 38% of forms estimated with an error | 12 fields, simulated, Gujarat | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Form time | About 1:39 per 12-question record | Same | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Barcode-assisted paper entry | 1% or below | Rural India | [Medhi 2011 on CAM](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf) |
| Tap&Map task success | 97.5% | Congo Basin | [Skarlatidou 2019](https://discovery.ucl.ac.uk/10078615/1/ecscw2019_Skarlatidou_ep02.pdf) |
| Learning in 1.5 h | Time −44%; errors −62% (computed from 476.7 to 264.6 s and 7.4 to 2.8) | Kannada, semiliterate, n=12 | [Findlater 2009](https://www.dgp.toronto.edu/public_user/ravin/papers/chi2009_literacy.pdf) |
| General web benchmark | 78% task completion, SUS average 68 | Not this population; 68 is average, not a pass | [MeasuringU](https://measuringu.com/?p=138); [Bentley](https://www.bentley.edu/centers/user-experience-center/what-every-client-should-know-about-sus-scores) (snippets) |

### Inferences

**Proposed release targets for one core task, "capture one network asset", on the worker's own phone:**

| Metric | First unaided attempt, after 45-60 min training | After one week of use |
|---|---|---|
| Completion with no level 3 prompt | at least 70% | at least 90% |
| Median time per asset (excludes walking) | under 3 min | under 90 s |
| Taps, common case | at most 8 | at most 8 |
| Prompts per task (level 1-2) | at most 2 | at most 0.5 |
| Record-level error, by physical audit | at most 10% | at most 5% |
| Critical error (wrong asset type or location beyond tolerance) | at most 3% | at most 1% |
| Photo usable for audit | at least 90% | at least 95% |
| Unsaved or lost data | 0 | 0 |
| Literacy gap (lowest versus highest stratum) | Completion within 15 points | Within 10 points |

The 5% record-level figure is deliberately much better than the roughly 38% implied by the forms baseline, on the assumption that photo, QR and auto-capture remove most typing. Treat the figure as a hypothesis until a pilot confirms it.

**Practical field test:**
1. **Sample:** 12-16 workers per round, mixed across state and language: at least 4 who cannot read a simple local-language sentence if such workers exist in the workforce, 4 who read haltingly, 4 fluent. Include women if crews include them, because Medhi's gender differences may apply. Screen by read-aloud privately, not as a public test. Pay at least a day's wage equivalent, and schedule around shifts.
2. **Statistics:** report counts with intervals, not bare percentages. Computed here with an adjusted Wald 95% interval, 10/12 successes corresponds to about 54-96%, which is only strong enough to find major problems. Run 2-3 rounds of about 12 for iteration, then a larger pilot of at least 30-50 workers and several hundred captures for accuracy.
3. **Setting:** real streets and hardware, midday sun, the worker's own phone or a representative low-cost Android, a dead-zone segment with airplane mode, a noisy site, and tools or gloves if used.
4. **Tasks (6-8):**
   - Add a pole with a tag
   - Add a box without a tag
   - Record a cable run
   - Find an existing asset nearby on the map
   - Locate yourself and walk to a marked target
   - Fix a wrong entry using undo
   - Recover from no GPS
   - Sync after returning online
5. **Ground truth:** before the session, independently record correct asset type, photo and location with a good GPS. Afterwards, compare every field and classify errors as harmless, correctable or critical, following Patnaik's distinction between detectable and dangerous errors. Report which errors your validation would have caught.
6. **Instrumentation:** log per-screen time, taps, back and undo use, audio plays, GPS accuracy at capture, retries, and offline duration. Audio plays per task should fall over time for semiliterate users, as in Findlater, and flat use may indicate someone who needs permanent audio support.
7. **Comprehension checks:** ask workers to explain in their own words what a state means ("Saved on phone"), point to the icon for a term, or show what will happen next. Avoid asking for SUS as the primary measure; use a picture-based 3-point face scale only as low-weight supplementary data, and apply response-bias caution.
8. **Bias control:** independent moderator, no mention of who built it, and compare with the existing process (for example paper or WhatsApp photos) rather than asking opinion.
9. **Longitudinal:** at 1 and 4 weeks, measure solo capture rate, record error by random physical audit of 5-10% of assets, sync delay, and help requests per worker. Retention is the unknown here.
10. **Decision rule:** any critical-error pattern or lost-data event blocks release regardless of averages. Fix any problem seen in 3 or more participants before the next round.

**Priority ordering, based on evidence strength:**
1. Remove typing and hierarchy.
2. Include icon, text and recorded audio together.
3. Use auto-GPS with a landmark-labelled map.
4. Use photo and QR capture.
5. Provide offline-safe saving and undo.
6. Use field-derived vocabulary.
7. Run a physical audit loop.

### Gaps
- No published benchmark for task time, step count or error rate in low-literate ISP or utility mapping.
- SUS and similar questionnaires are not shown here to be valid with low-literate users; I found no validated Kannada or Telugu version.
- The proposed thresholds need calibrating against the operator's current manual data quality and the cost of a mistake, neither of which is available from this literature.
