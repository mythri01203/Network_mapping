# FiberGIS browser walkthroughs (end-to-end tests)

These scripts drive the real app in headless Chrome, the way a person would, and check what the server stored afterwards. They cover Workflows A to L of the network mapping plan; what else covers each workflow (unit and API tests) and the last results are in `docs/NETWORK_MAPPING_TEST_PLAN.md`.

## Safety

- Every walk runs against **its own temporary server on `127.0.0.1:5056`**, started by `e2e/run.mjs` with a **temporary database** in a fresh temp folder (`SEED_SAMPLE_DATA=false`, except the login walk, which uses the demo network). The server is killed and the folder deleted afterwards.
- The harness (`e2e/lib/harness.mjs`) refuses any other address or port, and `run.mjs` refuses to start when something already listens on 5056. The real server (port 5000), the dev servers and `apps/server/data/` are never used.
- The web app is built into the temp folder (`--build`), never into `apps/web/dist`.

## What you need

Nothing is installed by these scripts, and `puppeteer-core` is **not** a dependency of this repo. Point the scripts at your own copies:

| Variable | What it is |
|---|---|
| `E2E_PUPPETEER_DIR` | A folder whose `node_modules` holds `puppeteer-core` (for example a folder where you ran `npm install puppeteer-core` yourself). |
| `E2E_CHROME` | The Chrome or Chromium program, for example `C:/Program Files/Google/Chrome/Application/chrome.exe`. |
| `E2E_STATIC_DIR` | Optional: a folder with an already built web app (`index.html`). Without it, pass `--build`. |
| `E2E_VERBOSE` | Optional: `1` prints every walk's lines as they run. |

The repo's own packages must be installed as usual (`npm install` at the root); the runner uses the `tsx` and `vite` already there.

## Running

```sh
# Git Bash or any POSIX shell
export E2E_PUPPETEER_DIR=/path/to/folder-with-puppeteer-core
export E2E_CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
node e2e/run.mjs --build            # every walk but L, desktop size (1500 x 950)
node e2e/run.mjs --build L          # Workflow L, the 100,000-record measurement (minutes)
node e2e/run.mjs --build A G        # the walks that cover Workflows A and G
node e2e/run.mjs D-fiber --phone    # one walk by name, phone size (360 x 740); needs E2E_STATIC_DIR or --build
node e2e/run.mjs --build --both     # desktop and phone (phone only for walks that were used at phone size)
node e2e/run.mjs --list             # every walk and what it covers
```

PowerShell: `$env:E2E_PUPPETEER_DIR = 'C:\path\to\folder'; $env:E2E_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; node e2e/run.mjs --build`.

`--keep` keeps the temp folder: each walk's `server.log`, `walk.log` and screenshots (`out/`). The runner prints a table and exits with 1 when any check failed or a walk did not finish. A single letter picks every walk that covers that workflow; a longer word picks walks by name.

Each walk prints `PASS | ...` or `FAIL | ...` per check, then `BROWSER ERRORS n` and `SUMMARY x pass, y fail`. A walk can also be run by hand against a server you started yourself on 5056 with a temporary database: `E2E_MODE=phone node e2e/workflows/A-field-walk.mjs`.

## The walks

Each file is named after the workflow it is filed under; most cover several.

| File | Covers | Level | What it checks |
|---|---|---|---|
| `A-field-walk.mjs` | A, B, G | Browser | Follows the field-helper guide on an empty network: place an OLT (port count asked, not assumed) and a box, draw a cable that snaps to both and is saved with both ends linked and nothing invented, move the box (the cable end follows), add a customer (nothing preselected, GPS fills the house, no made-up ONT serial), the service path, other jobs. Each tap also reports whether a finger could reach it. |
| `A-equipment-records.mjs` | A, C, D, J | Browser | Seven inspector tabs, history shows only real entries, a work record saved on the box, placing by typed position (marked typed), a pole inspection, a fibre marked faulty with its reason, giving it out held back without an override reason, the server audit trail and its screens. |
| `B-cable-route.mjs` | B, E, F | Browser + API | Turn a cable round (ends swapped, line reversed, fibres kept), the route editor, a splice entered by mistake kept in history with the reason, an ODF port marked faulty, sites and racks, the map-area query and catch-up. |
| `B-stretches-review.mjs` | B, A, G, J | Browser + API | The office accepts a field capture (Active, with who and when), an OLT with 12 PON ports (count asked; no splitters made by themselves), a cable stretch pole to pole on the one cable, a second organisation that sees nothing of the first. |
| `C-osp-routes.mjs` | C, K | Browser | Proposed span from the field order, confirm it, cable on the span, engineer answers, lengths kept apart, pole details and permission, duplicate warning, duct with sub-ducts and occupancy, KML and KMZ import (preview, the person chooses, nothing assumed), the office list of spans to confirm. |
| `D-fiber.mjs` | D, E, F, H | Browser | OLT port address and optics class, cable layouts, ODF patch, closure with trays and a photo, a chosen splice, splitter input on the exact fibre, customer setup marks its fibres, trace core by core, a broken splice named exactly, a conflicting splice and a double allocation refused, a 96F non-TIA cable, an unknown colour scheme shows no invented colours. |
| `G-customers.mjs` | G, H, I | Browser + API | Two customers on a splitter, ONT record, two services on one fibre, an MDU with floor box and units, disconnect (fibre and output released with history), move (double allocation refused, by screen and server), ONT swap, logical view with a gap named, reading reconciliation, the map-check script on the temp server. |
| `G-monitoring.mjs` | G, I | Browser + API | No live connection before any source, push source and token, readings with a device time, CSV import with an unmatched row listed (not guessed), stale readings, an LOS alarm, TEST simulator rows kept out of the counts. |
| `H-connections-search.mjs` | H, F, G, J | Browser | A splitter output marked faulty, a box's connections with a recorded check, a customer path fixed from the links, search by serial and the attribute table, a read-only account sees no customer names. |
| `H-faults.mjs` | H, G | Browser (two profiles) | A TEST LOS on 5 of 6 customers: suspected splitter with evidence, a fault with the affected customers from recorded paths ("may be affected" when not fully recorded), closing without a check refused, a work order done on a phone with photo, step, material and reading, two devices editing one job (both versions kept, the office decides). |
| `I-trace-validation.mjs` | I, H | Browser | The network trace shows the missing link and never fills it, the map check stores findings and a decision needs a note, capacity from records (a plan changes nothing real), live status says there is no live connection, topology built from recorded links. |
| `J-login-roles.mjs` | J, K | API + browser | Setup mode, the first administrator, a second setup refused, roles refused in plain words (403), the viewer can only read, repeated wrong passwords slowed down, a broken restore refused by the link check, backup and data-quality report, logout, the login screen and the viewer notice. |
| `L-performance.mjs` | L | Browser + API | Phase 24b. `run.mjs` first writes the server benchmark's synthetic network (100,000 records; `E2E_L_RECORDS=30000` for another size) into the temp database with `npm run benchmark -- --write-db=`. Then it times, and prints as `MEASURE \| name \| ms`: the first load by map area and with the whole network chosen (and the browser memory), a pan to a place not loaded yet, a search for a pole outside the loaded area, a pole renamed and moved (server round trip), another device catching up, zooming out to groups. The checks are about truth: "Part loaded" shown, the far pole found through the server. Runs only when named (`node e2e/run.mjs L`), takes a few minutes, and the timings depend on the computer. `E2E_L_WHOLE=0` skips the slow whole-network part. |
| `K-backup-roundtrip.mjs` | K | API | Backup as JSON and zip, restore after changes gives the same network, a safety copy first, a device told to reload after a restore, a broken backup refused with its problems and nothing changed, the zip restores too. |

Workflows E (splicing) and F (ODF) have no file of their own: they are checked inside `D-fiber.mjs`, `B-cable-route.mjs` and `H-connections-search.mjs` (`node e2e/run.mjs E` runs those).

## Writing a new walk

Start from an existing file. Import what you need from `../lib/harness.mjs`: `seed()` stores the starting records through the normal checked write, `openApp()` opens the app and returns the page helpers (`find`, `tapId`, `tapText`, `setField`, `typeInto`, `tab`, `check`, `shot`, ...), `network()` reads what the server stored, and `finish()` prints the summary and sets the exit code. Add the walk to the `WALKS` table in `run.mjs`.
