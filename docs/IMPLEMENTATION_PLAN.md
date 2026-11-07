# FiberGIS implementation plan

**Status: approved. Phases 1 and 2 have been built on branch `feature/easy-mapping` (not yet committed); later phases are not started.** Phase 2 was checked only by scripts in desktop Chrome at phone size, with a fake camera and simulated GPS. Its acceptance test, 12 to 16 workers on a real street, has not been run, so Phase 2 is built but **not accepted**. It covers items 8 to 12 of section 31 of `FiberGIS_Final_Master_Prompt.md`, based on [AUDIT_REPORT.md](AUDIT_REPORT.md) and `reports/ISP and cable TV mapping rules.md`.

## Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| 1 | Approve the order below, which differs from the prompt's by doing honesty and easy capture first | Yes. Your staff get value soonest, and later phases build on correct data |
| 2 | Field languages first | Telugu and Kannada, since the sample network is in Bengaluru and your prompt names Telugu. Please confirm where your crews work |
| 3 | Keep SQLite or move to PostgreSQL with PostGIS | Keep SQLite until about 50,000 records or several servers are needed. It is a large change with no benefit today |
| 4 | Map tiles | Replace undocumented Google URLs with a licensed or OpenStreetMap source before selling this |
| 5 | Interview 5 to 10 cable operators before building Cable TV | Yes. Today's picture of Indian LCO plant rests on seller listings and could be wrong |
| 6 | Who reviews safety wording | A qualified safety person, before any safety text reaches staff |
| 7 | Real OLT integration | Need the vendor and model of your OLTs, and access to one, before Phase 7 can start |

## Phases

The prompt lists 14 phases. These group them by what field staff and engineers need first. Each phase ends with its tests passing and existing features rechecked.

### Phase 1: Stop wrong data (first)

**Why first:** everything later depends on it. Small and low risk.

- Rewrite the main trace to report gaps instead of inventing them
- Stop saving estimates as measured. Add origin (`designed`, `calculated`, `field_measured`, `device_reported`) to readings, and show "Not recorded" or "Estimated"
- Remove fake fallbacks and "Live" labels
- Use one loss calculation and one editable settings table
- Stop saving invented serials, owners and locations
- Fix: clicking pins while drawing, unintended pin dragging, "Drop Pole Here" position, sync blocking after one rejected record

**Accept when:** a cable joins at any zoom level; a customer with a missing link shows the exact gap; the budget calculator reproduces the worked examples in `fibergis-ftth-mapping`; no screen says Measured or Live without a real source; a cable can be finished by tapping the box.

### Phase 2: Easy field capture

A separate phone flow alongside the engineer screens, which stay as they are.

**Build these first, or the flow can lose data:** photos in IndexedDB with an upload queue instead of `localStorage`, reported storage failures, unique IDs so two offline phones cannot overwrite each other, https, and a service worker.

- Large picture tiles, camera first, automatic GPS with accuracy stored, a "same pole?" check, photo choices, summary card
- Continuous pole placement and "next pole" linking
- QR scanning of pre-printed tags
- Number pad with no typed minus sign or decimal
- "Saved on phone", "Sending", "Sent to office"
- Telugu and Kannada framework with a crew-tested glossary, then recorded audio
- Service worker so the app opens offline

**Accept when:** the targets in `fibergis-easy-field-ux` are met on a real street with 12 to 16 workers, with zero lost data.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Photos in IndexedDB, compressed; separate upload queue with retries; `/api/v1/photos/<id>` on the server | Built, unit and script tested |
| Random capture IDs, idempotent save, display names kept apart | Built, unit tested |
| Storage failures reported ("Not saved on phone") | Built, unit tested |
| Service worker and manifest; app opens offline after one visit | Built, script tested on localhost. Needs https on phones; see `DEPLOYMENT_GUIDE.md` |
| Tiles, camera first, averaged GPS, "same one?", QR with "No tag", picture questions, summary, Next, Undo, Finished | Built, script tested. QR decoding is unit tested; scanning a real printed tag with a real camera is not |
| "Next pole" | Records order only (`previousAssetId`). Spans are Phase 3 |
| dBm pad, light reading stored as `field_measured` with meter photo | Built, script tested |
| Report danger as an unsafe Safety Hazard fault | Built. Safety wording is draft until decision 6 |
| Sync chip: Saved on phone, Sending, Sent to office | Built, script tested offline and back online |
| Telugu and Kannada | Framework and draft strings only. **No string reviewed**, glossary untested; see `LANGUAGE_REVIEW.md` |
| Recorded audio | Mechanism only. **No clips recorded** |
| Office list of captures to place or check | Built (Operations, Field captures). Hazards with no GPS fix cannot be moved on the map yet |
| Library choices | Own i18n, IndexedDB wrapper and service worker instead of i18next, Dexie and vite-plugin-pwa; zxing-wasm for QR (maintained; jsQR has had no release since 2021) |

### Phase 3: Real poles and routes

Attachments, aerial spans, slack loops as points, ducts as lines with occupancy, manholes, type-specific details, owner and permission on each pole, separate drawn, sheath and optical lengths, duplicate check before creating, KML and KMZ import.

**Accept when:** an engineer can answer "which poles support this route?" and "which cables are on this pole?", and a real KML file imports without assumptions.

### Phase 4: Real fiber path

Per-cable color scheme and tube size, core allocation and release, closure creation, trays, splice validation with history, ODF panels and patches, one splitter model with cascades, and trace following actual cores through splices. Includes the validators in `fibergis-ftth-mapping`.

**Accept when:** end-to-end example A in the prompt traces core by core; conflicting splices and allocations are rejected; a 96F cable with a non-TIA scheme works.

### Phase 5: Customers and connections

Disconnect and reassign, ONT records separate from customers, multiple services per building, buildings with entry, riser and floor, logical and physical views, reconciliation (predicted against measured Rx, drawn against sheath length).

### Phase 6: Cable TV

**After the operator interviews.** Replace mock screens with real records. Directional RF tree, powered and passive nodes, taps, unit-safe levels with test point offset, separate customer flow, overlay on shared fiber, switchable level profiles.

**Accept when:** end-to-end example D works, and no value on the Cable TV page is hard-coded.

### Phase 7: Live monitoring

**Blocked until decision 7.** Adapter for your actual OLT, readings with source and time, stale data handling, online/offline/LOS history. Until then the app says "No live connection".

### Phase 8: Faults and field operations

Evidence-based correlation worded as "suspected", affected customers from real paths, full alarm lifecycle, work order photos and verification, conflict handling for offline edits.

### Phase 9: Reports, security, production

Login and enforced roles, protected reset and restore, rate limits, https deployment, reviewing `npm audit` results, clustering and viewport loading, complete reports.

**Move login earlier if** the server will be reachable from outside a trusted network before Phase 9. It must not be exposed without it.

## Data and API changes

- **Keep the JSON record table and `/api/v1` conventions.** Add collections rather than replacing them: `poles` details on equipment, `spans`, `ducts`, `permissions`, `readings`, `inspections`, `settings`
- **Add server-side link checks,** which are missing today. The same domain rules should run on client and server
- **Add** a `readings` collection with origin, unit, source and timestamp, and migrate the existing Rx values to `calculated` or unknown, never `measured`
- **Add** lengths as separate fields, and method and accuracy on points
- **Existing records keep working.** Every change uses a migration and a backup first

## Libraries

Add only when the phase needs it. Check security and maintenance at that time.

| Library | Phase | Why |
|---|---|---|
| i18next with react-i18next | 2 | Telugu and Kannada; none exists |
| A JS or WASM QR scanner | 2 | `BarcodeDetector` is unreliable |
| vite-plugin-pwa or a hand-written service worker | 2 | App must open offline |
| IndexedDB (Dexie) | 2 | Photos overflow localStorage |
| Turf.js | 3 | Geodesic length, spatial helpers |
| Supercluster | 9 | Marker clustering |
| Playwright | 1 | End-to-end tests; the current browser script is outside the repo |

**Not recommended now:** replacing Leaflet, PostGIS, TanStack Query, React Hook Form, ELK. No current need justifies them.

## Risks and outside dependencies

| Risk | What to do |
|---|---|
| Building on invented data | Phase 1 first |
| Field design assumptions come from old studies on old phones | Test on your own crews; targets are proposals |
| Indian LCO picture may be wrong | Interviews before Phase 6 |
| No TEC or BSNL color table, gazette unread, Indian STB levels dated | Keep editable, with source and date; get a legal and an RF review |
| Telugu and Kannada wording | Native speakers and crews must check it |
| Safety wording | Qualified reviewer |
| Real monitoring needs vendor access | Decision 7 |
| Google tile terms | Decision 4 |
| No login | Keep the server on a trusted network |

## Project skills that support this work

Stored in `.claude/skills/`:

| Skill | Use |
|---|---|
| `fibergis-data-truth` | Any change that creates or shows network data |
| `fibergis-ftth-mapping` | Fiber, GPON and EPON rules and values |
| `fibergis-cable-tv-mapping` | HFC and Cable TV rules and values |
| `fibergis-osp-mapping` | Poles, ducts, GPS, length, India rules, safety |
| `fibergis-easy-field-ux` | Any screen field staff touch |
| `fibergis-field-helper` | Plain-language help using today's app |
| `fibergis-map-check` | Read-only data health check |
