---
name: fibergis-easy-field-ux
description: Design rules that make FiberGIS easy for field staff with little formal education or limited reading. Use whenever you design, build or review any screen, form, button, label, icon, error message, map interaction, translation or wizard that field workers, technicians, splicers or small cable operators will touch, including Telugu or Kannada support, phone layouts, voice, QR scanning, GPS capture and training, even if the request only says "make it simple" or "improve the UI".
---

# Easy field screens

Assume the person is standing in the sun, holding a low-cost phone, possibly in gloves, afraid of breaking something, and may not read English or their own language well. If it works for them, it works for everyone.

**Principle: the field captures evidence, and the system does the engineering.** A worker should never see a loss budget. The photo, QR scan and meter reading they give are what make the engineering checkable.

**Read these too when designing capture:** `fibergis-osp-mapping` for GPS limits, required fields, IDs and duplicates; `.claude/skills/fibergis-osp-mapping/references/india-rules.md` for safety wording; `fibergis-data-truth` for what may never be invented. Engineer-only screens are out of scope, so do not simplify them away.

## What the evidence says

- **Text alone fails.** Low-literate first-time users in Bangalore on a banking task: text 0/20, voice 13/18, graphics 20/20 (slowest, because people feared "spoiling" the phone). Strong, but from 2007–2013 feature phones, so test whether WhatsApp-era users differ.
- **Menus fail even without text.** 56 of 90 could not navigate menus, and 23 of the 34 who managed on their own phone failed on another. Keep things flat.
- **Form validation misses wrong choices,** because a wrong choice looks valid. Trained workers erred on 4.2% of entries, and about 38% of forms held an error. Photos and site audits are the only check.
- **Half of numeric-field errors** came from decimals and backspacing, such as "1006" for 100.6.
- **Text, icon and audio together** beat a separate "illiterate mode". Kannada semiliterate users cut task time 44% in 1.5 hours and wanted audio kept for confidence.
- **Scanning beats typing.** Barcode entry reached 1% error or below; neither study tested weathered labels.
- **Stated preference lies.** People were 2.5 to 5 times more likely to favor what they thought the interviewer built. Watch tasks instead of asking opinions.

Not tested with this audience, so treat as reasoned defaults: one question per screen, undo over confirm, plain errors, sync indicators.

## The capture pattern

Aim for five or six taps in the common case; eight is the upper limit in testing. For a pole, box or drop:

1. **Big tile with a picture**, read aloud: "Add box". Create the record's unique ID here, so a repeated save does nothing, and start GPS
2. **Camera opens**, with a framing guide and a spoken instruction. A guide needs `getUserMedia`, since a native capture input has no overlay. Save the draft first, because the browser may drop the page
3. **GPS is captured automatically.** Show progress, never coordinates
4. **Same one?** If a same-type asset is nearby, show its photo: "Same pole" or "New pole". Skip this screen otherwise
5. **Scan the QR** on the tag, if there is one, with a big "No tag". A known tag opens that record
6. **One or two photo choices** that advance on tap, using the required fields from `fibergis-osp-mapping`, such as owner and material, with photos of this operator's real items
7. **Summary card** with photo, icon and a small map pin, read aloud, with a big Save and "fix"

**After Save,** return straight to step 2 with "Next", so a street of poles needs no repeating.

**Link, do not draw.** The goal is: pick a nearby existing pole, tap "next pole", take a photo, and the span fills in. Spans do not exist in the data yet, so until they do, record the order only. Do not let a tap claim a cable exists; the office confirms it.

**No GPS fix.** Show "Go to open sky. Wait for the green tick." After a short wait, let them save with the photo, marked "office must place this". Never store it as accurate, and never make the worker correct it on a map.

**First run.** The browser's camera and location prompts may be in English and are often the first failure. Show a picture of what to tap before they appear, and a picture of how to fix a denied permission. Camera and GPS need HTTPS.

## Rules

**Numbers.** The worker never types a minus sign, decimal point or unit. A dBm pad supplies the sign and decimal, reads the value back aloud, and captures a photo of the meter as proof. Use range checks for the rest.

**Words.** Say what it is, not its engineering name. Reuse what already works: "Main Road Line", "Street Line", "House Wire" (`apps/web/src/features/catalog/ComponentLibrary.tsx:482-503`). Put a photo beside each term. Avoid: upstream, provision, CPE, tariff, node, matrix.

**Errors are next actions.** "Go to open sky. Wait for the green tick." Log the code rather than showing it. State consequences plainly: "Customer's line will show on the wrong pole."

**Fear of breaking things.** Make every field action undoable and say so aloud; after sending, undo should remove that one item through the office history, not rewind shared history. Reserve confirmation for destructive actions, with the item's photo and buttons named by outcome ("Delete this pole", "Keep it"). Autosave silently. Give a sound and a tick after each save, plus vibration where the phone supports it.

**Sync has three states,** each with icon and spoken phrase: "Saved on phone", "Sending", "Sent to office", with counts in digits. Submit idempotently, because anxious users repeat entries.

**"Saved on phone" must be true.** Show it only after the write has succeeded. Since Phase 2 the capture flow does this: compressed photos and each finished capture go to IndexedDB first (`features/capture/captureStorage.ts`, writes resolve only when the transaction completes), then into the shared network, and photos upload through their own queue to `/api/v1/photos/<id>`. Capture IDs are random (`newCaptureId`), so two offline phones cannot collide, and a repeated save does nothing. The engineer screens still keep their photos and records the old way (whole collections in `localStorage`), so do not route new field capture through them.

**Safety.** Never reward moving closer to a pole or wire for a better photo or GPS fix. A hazard report is one tap. Safety wording needs review, as `fibergis-osp-mapping` explains.

**Odd cases.** A one-tap call or voice note to a supervisor, so nobody is pushed into guessing. A live operator was about nine times more accurate than forms.

**Maps.** Open centered on GPS with a big "you are here". Show distance and an arrow to the target. Label with landmarks and earlier photos, not street names or compass directions. No landmark data exists yet, so collect it from capture photos and voice notes ("near the temple") rather than promising labels that have no source. Use realistic icons of this operator's actual hardware, plausible colors and no legends: yellow roads were rejected because "roads can never be yellow". Offer a one-tap satellite toggle and test it, because no study covered how this audience reads satellite imagery.

**Essential tasks avoid** long-press, drag, pinch, hover and keyboard shortcuts.

## Sizes (proposed starting values)

In this web app, 1dp is 1 CSS px and sp means `rem`-based text. Glove mode is an optional setting, off by default.

| Item | Value |
|---|---|
| Absolute minimum target | 48dp, 8dp apart |
| Routine controls | 64–72dp |
| Main button | Full width, at least 72dp, bottom third of screen |
| Glove mode | 2 columns, about 126dp |
| Contrast | 7:1 text, 4.5:1 icons; never color alone |
| Telugu and Kannada body | 18sp, weight 500, line height 1.7–1.8 |

Test on low-cost phones at midday, in both light and dark, since no good study settles which reads better in sun. Use `rem`, never fixed button heights, and check conjuncts at the largest system text size on a real device, because browsers do not all honor that setting. Self-host subsetted Noto Sans Telugu and Kannada for offline use, and set `lang`.

## Language and audio

- **Do not use `speechSynthesis`.** Chrome on Android can silently fall back to an English voice, and Android WebView lacks it. Ship human-recorded clips, cached offline. For changing numbers, join pre-recorded digits or pre-generate with cloud speech and human review, as a deliberate exception to the no-concatenation rule below, which applies to written text. Show the speaker only where a recording exists: Telugu read by an English voice is worse than silence. Browsers may block sound that follows no tap, so test it.
- **Do not translate literally.** Build the glossary by recording crew conversations and running a recognition test by region. Write loanwords in local script. Telangana wording may not transfer to coastal Andhra.
- **Drafts are allowed, but never final.** If asked for Telugu or Kannada now, give them labelled "DRAFT: needs native speaker and crew check", with the terms to test, such as పోల్ against స్తంభం. Do not ship or record audio from a draft until it is reviewed. In code, mark unreviewed strings, for example `reviewed: false`, so they can be listed.
- **Offer English freely.** Non-fluent users often choose it.
- Store canonical codes, use ICU message keys, never concatenate sentences. Use Western digits unless a region proves otherwise.
- `BarcodeDetector` is experimental, so bundle a JS or WASM scanner. Offline maps must be packaged.

## Where this codebase stands

**Phase 2 (November 2026) built the separate field flow at `/capture`** (`apps/web/src/features/capture/`), reachable from the green **Field capture** button on the phone map bar and from the sidebar. Built and checked by a script in desktop Chrome at 360 x 740 with a fake camera and simulated GPS. **Nothing has been tried with real workers, on a real phone, or in sunlight.** None of the targets in `references/field-testing.md` has been measured.

- Tiles for Add pole, Add box, Add customer drop, Record light level, Report danger; camera first (`getUserMedia` with a framing guide, falling back to `<input capture>`); automatic averaged GPS with a progress ring and tick; "same one?" with the nearby photo; QR scan with "No tag" (zxing-wasm, served locally); picture questions defined as data in `choices.ts`; summary card with a mini map; Save, then Next, Undo or Finished
- Taps measured by the script (no tag): pole 6, next pole 6, box 5, danger 3, pole with no GPS fix 7, "same pole" 3, light level 4 plus the digits (8 for -18.52)
- dBm pad: digits only, sign and decimal supplied, read back large, range check warns but never blocks, meter photo required; stored as `field_measured`
- No fix: "Go to open sky", then "office must place this" (flag plus honest method), listed for the office under Operations, Field captures
- Sync chip: Saved on phone N, Sending, Sent to office, Not saved on phone. "Sent" needs both the record acknowledged and every photo uploaded
- Small ICU-style i18n (`apps/web/src/i18n/`), language picker per device, `lang` set, self-hosted Noto Sans Telugu and Kannada at 18 px, weight 500, line height 1.7. **Every Telugu and Kannada string is an unreviewed draft** (`docs/LANGUAGE_REVIEW.md`)
- Audio clip mechanism (`/audio/<lang>/<key>.mp3` with a manifest, cached offline, draft words never played). **No clips recorded**, so no speaker shows and nothing is read aloud yet
- Service worker and manifest, production only, need https on phones (`docs/DEPLOYMENT_GUIDE.md`). Map tiles are not stored offline
- Safety reminder on the danger screens, labelled draft wording pending a safety reviewer
- Spans still do not exist: "Next pole" records order only (`previousAssetId`), never a cable

Still true of the engineer screens, which Phase 2 left as they were:

- `Button.tsx` sizes run 24 to 36 px (default 32), and about 570 uses of 10 and 11 px text exist; engineer screens are English only
- Hover tooltips, shortcuts and drag-to-place carry essential tasks
- Worst screens: `SpliceModal.tsx`, `SplicingModal.tsx`, the seven-tab `OltConfigModal.tsx`, `CustomerWizardModal.tsx` (typed coordinates)
- `TechnicianMobileView.tsx` and `BikerModePanel.tsx` "Drop Pole Here" are older field tools outside the capture flow; prefer `/capture`
- Keep: `EquipmentIllustration`, plain labels, beginner knowledge base

All new field capture goes through `/capture` and `captureService.save`; do not add capture to the engineer screens.

## Testing

Read `references/field-testing.md` before claiming a screen is easy. Task success on a real street is the only proof.
