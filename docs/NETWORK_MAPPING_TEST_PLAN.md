# Network mapping test plan

What checks each network mapping workflow (A to L, from [NETWORK_MAPPING_FEATURE_MATRIX.md](NETWORK_MAPPING_FEATURE_MATRIX.md), M33), how to run it, and the last results. Written in Phase 24b (11 November 2026).

There are three kinds of test:

| Kind | Where | What it proves |
|---|---|---|
| Unit | `packages/shared/test/*.test.ts`, `apps/web/src/**/*.test.ts(x)` | The rules and screens' logic on their own: what is refused, what is worked out, that nothing is made up |
| API | `apps/server/test/*.test.ts` | The server: every write checked inside its transaction, roles, organisations, the routes' answers, equivalence of the quicker checks with the old whole-network ones |
| End to end | `e2e/` | The real app in headless Chrome, driven as a person would, against a temporary server; then what the server stored |

## How to run

```sh
npm test -w @fibergis/shared                  # unit, shared rules
npm test -w @fibergis/web                     # unit, web app (sync engine, map, screens)
npm test -w @fibergis/server                  # API
npx tsc --noEmit -p packages/shared           # and -p apps/server, -p apps/web
npm run benchmark -w @fibergis/server         # server timings on 100,000 synthetic records (temporary database)

# End to end (see e2e/README.md): your own puppeteer-core and Chrome, never a dependency of the repo
export E2E_PUPPETEER_DIR=/path/to/folder-with-puppeteer-core
export E2E_CHROME="/path/to/chrome"
node e2e/run.mjs --build        # Workflows A to K, desktop
node e2e/run.mjs --build --both # desktop and phone
node e2e/run.mjs --build L      # Workflow L, 100,000 records (a few minutes)
```

The end-to-end runner only ever starts its own server on `127.0.0.1:5056` with a temporary database (and refuses to start if that port is taken). It never uses port 5000 or 5055 or `apps/server/data/`. Server tests can time out when the computer is busy; run a failing file alone before calling it a failure.

## Workflows

| Workflow | Unit | API | End to end |
|---|---|---|---|
| **A** Basic equipment: place, edit, inspect, persist | `equipment`, `assetPlacement`, `catalog`, `records`; web `placement`, `placementModes`, `AssetTabs`, `inventoryRows`, `networkStore` | `app`, `phase3`, `phase19fieldReview` | `A-field-walk`, `A-equipment-records`, `B-stretches-review` |
| **B** Cable mapping: draw, route, split, join, stretches | `cables`, `cableEngineering`, `cableSegments`; web `cableRouteActions`, `cableSegments` | `phase5Cables`, `phase6`, `cableSegments` | `A-field-walk`, `B-cable-route`, `B-stretches-review` |
| **C** Outside plant: poles, spans, ducts, inspections | `outsidePlant`, `ospInfrastructure`; web `ospActions`, `ospPhase4` | `phase4osp`, `targetedGuard` | `C-osp-routes`, `A-equipment-records` |
| **D** Core management: tubes, fibres, states, overrides | `coreManagement`, `colors`, `ports`; web `fiberUi`, `crossSection` | `fiberCores`, `phase7` | `D-fiber`, `A-equipment-records` |
| **E** Splicing and closures | `splices`, `splicing`; web `splicing` | `phase8splicing` | `D-fiber`, `B-cable-route` |
| **F** ODF and patching, sites and racks | `odfPatch`, `sitesRacks`; web `rackElevation` | `phase9odf` | `D-fiber`, `B-cable-route`, `H-connections-search` |
| **G** FTTH: OLT, PON, splitters, customers | `oltToCustomer`, `oltPon`, `oltConfig`, `provisioning`, `splitterManagement`, `customerPath`, `connections`; web `oltPon`, `splitterSection`, `customerPaths` | `phase11splitters`, `phase12`, `phase20monitoring` | `G-customers`, `G-monitoring`, `A-field-walk` |
| **H** Topology and trace | `fiberPath`, `opticalPathTrace`, `networkTrace`, `trace`, `connectionIndex`, `logicalTopology`; web `networkTrace`, `topology`, `connections` | `phase13connections`, `phase14logical` | `H-connections-search`, `H-faults`, `D-fiber`, `I-trace-validation` |
| **I** Validation: map check, geometry rules, findings | `validation`, `fieldReview` | `phase15validation`, server guard tests in every phase file | `I-trace-validation`, `G-customers` |
| **J** Security: roles, permissions, organisations, audit | `access`, `permissions` | `security`, `phase9`, `phase12`, `phase23`, `phase23b`, `phase24b` (hiding on the new routes) | `J-login-roles`, `B-stretches-review`, `H-connections-search` |
| **K** Import and export, backup and restore | `kmlImport`, `dataImport`, `reports`; web `kml`, `fileImport`, `xlsxExport`, `reportExport` | `app` (backup, restore), `security` | `K-backup-roundtrip`, `J-login-roles`, `C-osp-routes` (KML import) |
| **L** Performance at 100,000 records | web `areaLoading`, `clustering`, `syncEngine`, `phase16` (table and search at 50,000) | `phase24`, `phase24b`, `targetedGuard`, `plainEdits`, `search`; `npm run benchmark` | `L-performance` |

Phases 17 (optical engineering), 21 (import and export) and 22 (reports) are being built now; their own tests are not listed here yet.

## Last results

Run on 11 November 2026 on the development computer (Windows, other work running at the same time).

| Suite | Result |
|---|---|
| Shared unit | 752 passed (53 files) |
| Web unit | 441 passed (59 files) |
| Server API | 221 passed (30 files) |
| Typecheck (shared, server, web) | Clean |

End to end, desktop (1500 x 950), build of the current working tree:

| Walk | Covers | Passed | Failed | Browser errors |
|---|---|---|---|---|
| `A-field-walk` | A, B, G | 57 | 0 | 0 |
| `A-equipment-records` | A, C, D, J | 15 | 0 | 0 |
| `B-cable-route` | B, E, F | 13 | 0 | 0 |
| `B-stretches-review` | B, A, G, J | 15 | 0 | 0 |
| `C-osp-routes` | C, K | 42 | **21** | 0 |
| `D-fiber` | D, E, F, H | 61 | 0 | 0 |
| `G-customers` | G, H, I | 63 | 0 | 0 |
| `G-monitoring` | G, I | 52 | 0 | 0 |
| `H-connections-search` | H, F, G, J | 15 | 0 | 0 |
| `H-faults` | H, G | 51 | 0 | 0 |
| `I-trace-validation` | I, H | 25 | 0 | 0 |
| `J-login-roles` | J, K | 24 | 0 | 0 |
| `K-backup-roundtrip` | K | 14 | 0 | 0 |
| `L-performance` | L | 6 | 0 | 0 |

**The `C-osp-routes` failures** are all in its last two sections, the KML and KMZ import: Phase 21 is replacing that screen with a new import wizard right now (other words, other buttons). Sections 1 to 10 (spans, attachments, lengths, pole details, permissions, duplicate warning, ducts) pass. Those checks need rewriting for the new wizard once Phase 21 is finished. When the walks were first ported earlier the same day, the same section had 10 failures, and at phone size every walk passed (11 phone-capable walks), except that import section.

## Workflow L: measured, and the proposed budget

The data is the server benchmark's synthetic network (`npm run benchmark`): 100,117 records, of them 40,000 poles, 35,000 spans, 18,000 customers, 5,000 cables and 2,000 attachments in a square of about 20 km. `e2e/workflows/L-performance.mjs` loads it into the temporary database and drives Chrome at 1500 x 950. One run; the computer was busy with other work, so treat the numbers as an upper side.

**Browser**

| Operation | Loaded by map area (Phase 24b) | Whole network on the device |
|---|---|---|
| First load, until "Saved" | 2.0 s | 23.9 s (55.9 s on a busier first run) |
| Browser memory after the load | 57 MB (78 MB after the whole walk) | 914 MB |
| Pan to a place not loaded yet, until drawn | 2.0 s (median of 3: 1.5 to 2.4 s), counted from the end of the drag; it includes the 0.4 s the app waits for the map to stop | nothing to load |
| Search for a pole outside the loaded area, until listed | 3.1 s after typing (the server's `GET /search` over 100,000 records is most of it) | 0.7 s, typing included |
| Zoom out 3 steps until drawn as groups | 1.1 s (the view is wider than what loads at once: its middle is loaded, and "Zoom in to load all" shows) | 6.5 s |
| Another open device catching up with edits made elsewhere | 0.6 s once it checks (every 30 s, or when the tab is shown again) | the same route |

The first pins appear in about 0.45 s in both cases, but those are the demo network bundled in the app, drawn until the server answers on a device that has never loaded before. That is how the app already behaved; the number to read is "until Saved".

**Edits (server, `POST /changes` round trip)**

| Edit | Before Phase 24b | Now |
|---|---|---|
| Pole renamed (or a note, photo, maintenance entry, serial: plain details) | 3.6 s in Phase 24a; 5.1 s in this session's benchmark while the computer was busy | 3 ms in the benchmark, 7 ms in the browser walk |
| Pole moved | 3.6 s | 5.3 to 7.3 s on the busy computer: unchanged, still the whole-network fibre check |

**Group index (pins drawn as groups).** An edit or a selection used to rebuild the group index every time. Building it takes 75 to 117 ms for 40,000 to 58,000 pins (Node, `supercluster` 9.1); checking that no pin moved takes 1 to 7 ms, so an edit or a selection that moves no pin now saves that rebuild. A pin added, removed or moved rebuilds the index in full, because a patched index could show a wrong count.

**Proposed budget (for you to agree or change).** Measured on this computer with other work running; a phone will be slower. Each line is about twice what was measured, rounded.

| Operation, 100,000 records, loaded by map area | Proposed budget | Measured | Met |
|---|---|---|---|
| First load until "Saved" | 4 s | 2.0 s | Yes |
| Browser memory | 200 MB | 57 to 78 MB | Yes |
| Pan to a new place, until drawn | 3 s | 2.0 s | Yes |
| Search for something not loaded, until listed | 5 s | 3.1 s | Yes |
| Zoom out to groups | 2 s | 1.1 s | Yes |
| Edit of plain details, server round trip | 100 ms | 3 to 7 ms | Yes |
| Move of an item, server round trip | 1 s | 5 to 7 s | **No**: the whole-network fibre check (later work) |
| Another device catching up, once it checks | 2 s | 0.6 s | Yes |

The whole-network load (24 to 56 s, over 900 MB) is why a network of 30,000 or more records in the map-area collections is loaded by map area. Below that, the whole network loads as before: Phase 16 measured search and the attribute table at 50,000 records within a tenth of a second, and a small network gains nothing from part loading while losing whole-network lists on the device. The 30,000 line is a judgement from these two measurements, not a separate measurement; it is one constant (`AREA_MODE_MIN_RECORDS` in `apps/web/src/api/areaLoading.ts`).

## What these tests do not cover yet

- **Phone sizes for Workflow L.** It was run at desktop size only.
- **The offline field capture walk** (`capture-walk`) and the Cable TV walk were not ported into `e2e/`; offline capture is covered by the web unit tests (`syncEngine`, `areaLoading`: an edit made offline in area mode is kept and sent) and by the earlier scratch walks.
- **Workflows E and F** have no walk of their own; their checks sit inside `D-fiber`, `B-cable-route` and `H-connections-search`.
- **Phases 17, 21 and 22** are being built now. The KML import part of `C-osp-routes` follows the Phase 21 screens, which are changing.
