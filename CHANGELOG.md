# Changelog

The network mapping work, phase by phase, summarised from the completion reports in
[docs/NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](docs/NETWORK_MAPPING_IMPLEMENTATION_PLAN.md). The plan holds the full
reports (what changed from the plan and why, tests, walkthroughs, what was left open). Nothing here is a release
number: the work is not committed as releases yet.

Phases 17 (optical engineering), 21 (import, export and data migration) and 22 (reports and analytics) are being
built now and are not listed.

## Phase 24b — 11 November 2026: big networks in the browser, kept tests, docs

- **Loading by map area.** On a network with 30,000 or more equipment, cable, customer, span, duct, slack loop and
  building records, the web app loads only the map areas a person looks at (`GET /network/area`), every other
  collection in full (new `GET /network?except=`), and the records those point to (new `GET /network/records?ids=`).
  Changes made anywhere still arrive through `GET /changes?since=`. Smaller networks load whole, as before; so does an
  older server. "Load the whole network on this device" is one tap. On 100,000 records: first load 2 s and 57 MB of
  browser memory, against 24 s and 914 MB for the whole network. A field capture loads the place where the worker
  stands.
- **Never shown as missing.** The top bar says "Part loaded" (also offline), with what that means for lists, counts,
  checks and reports. The search box also asks the server and loads what it finds.
- **Map groups kept between edits.** The pin group index is rebuilt only when a pin is added, removed or moved, not
  on every edit or selection.
- **Quicker pole edits.** An edit of an item's plain details (name, notes, photos, maintenance, serial and the like)
  skips the whole-network fibre and site checks and the read of every item for the duplicate warning: 5.1 s to
  3 ms on 100,000 records. 600 random change sets prove the answers are the same. A move still takes the full check.
- **Tests kept in the repo.** `e2e/`: browser walkthroughs for Workflows A to L on a temporary server (port 5056, temp
  database), with shared helpers and a runner. See [docs/NETWORK_MAPPING_TEST_PLAN.md](docs/NETWORK_MAPPING_TEST_PLAN.md).
- **Docs.** NETWORK_MAPPING_TEST_PLAN.md and this changelog; the deployment guide, API and schema pages updated.

## Phase 24a — 11 November 2026: server performance

- Paging (`limit`, `cursor`, `ids`, `bbox`, `changedSince`) on `GET /<collection>`.
- `GET /network/area?bbox=` on an SQLite R-tree; `GET /changes?since=N` catch-up, used by the browser.
- Targeted link, catalogue and alarm checks (a span saved: 1,303 ms to 1 ms on 100,000 records).
- Scheduled backups (`BACKUP_EVERY_HOURS`, `BACKUP_KEEP`); `npm run benchmark -w @fibergis/server`.
- Migration `user_version` 2 to 3: new tables only (`record_bounds`, `record_bounds_rtree`, `change_log`).

## Phase 23b — 11 November 2026: several ISPs on one server

- One database file (with its photos, voice and backups) per organisation; a new `control.db` lists them.
- Every request reaches only its own organisation's data. The existing database becomes the first organisation in
  place. A platform administrator can add, rename and switch off organisations.

## Phase 23a — 10 November 2026: security and administration

- Eight roles and per-action permissions, checked by the server inside each write.
- A server-written audit trail (`audit_events`), record revisions with compare, change requests with approval.
- Editable lists (equipment types, statuses, cable types, connectors, splitter ratios). Migration `user_version` 1 to 2.

## Phase 20 — 11 November 2026: monitoring and fault impact

- `deviceStatuses` for OLT, card, PON port and uplink rows; device alarms kept apart from reported faults.
- Fault impact follows recorded links only; a NOC view of OLT and PON ports. Live only with a real source.

## Phase 19 — 11 November 2026: field survey and offline mapping

- Field captures arrive "awaiting review" for the office; editable checklists; QR and 1D barcodes.
- The offline copy moved to IndexedDB; a sync history on the device.

## Phase 18 — 11 November 2026: planning and capacity

- Capacity per splitter, PON port, OLT card, ODF, cable, duct, pole and rack, with planned work held apart from built.
- Warning levels as settings, zone demand, what-if plans (`planningScenarios`), seven capacity reports.

## Phase 16 — 11 November 2026: search and attribute table

- Choosing several (box, lasso, tap the corners), a selection bar and an item menu.
- Search over ids, names, serials, fibres, ports and more (`GET /search`); an attribute table for 21 layers with bulk
  edit through one all-or-nothing write. Measured at 50,000 to 100,000 records.

## Phase 15 — 11 November 2026: tracing and validation

- One trace engine on the connection index, 12 trace types; gaps stop a trace and are named.
- Geometry rules and stored map check findings (`validationFindings`).

## Phase 14 — 11 November 2026: logical topology

- Physical (fibre links) and logical (service, ONT, PON port, OLT, VLAN) layers kept apart; a topology screen built
  from recorded links only.

## Phase 13 — 11 November 2026: physical connectivity

- A read-only connection index over 22 link kinds; recorded checks of links (`linkVerifications`);
  `GET /connections`.

## Phase 12 — 11 November 2026: customers and FTTH

- A customer's path is worked out from the fibre links only; the server refuses a path that contradicts them.
- Personal data by role.

## Phase 11 — 11 November 2026: splitters

- Level and arrangement from recorded links, split product, a splitter capacity report, faulty and reserved outputs.

## Phase 10 — 11 November 2026: OLT and PON

- Optional shelves, slots and cards; any port count; counts from records; splitters proposed, never created silently.

## Phase 9 — 11 November 2026: ODF and patching

- `sites` and `racks`; pigtails and patch cords on ODF ports; faulty and reserved ports; the feeder fibre marked in use.

## Phase 8 — 11 November 2026: splicing and closures

- Trays, cassettes and positions; pigtails in closures; direction checks; splices entered by mistake kept in history;
  a splice picture and a printable report.

## Phase 7 — 10 November 2026: tubes and cores

- Tube records of different sizes; Faulty and Retired fibres with history; an override reason to give out a bad fibre;
  find a fibre; a cross-section picture.

## Phase 6 — 11 November 2026: cable stretches

- `cableSegments`: stretches of a cable between structures, with lengths and install method; layers and splits follow.

## Phase 5 — 11 November 2026: fibre cable engineering

- Tap-only route tools, split and join, a seven-step cable wizard, build fields, a duplicate route warning.

## Phase 4 — 10 November 2026: outside plant

- Spans with drawn lines, ducts with fill from recorded sizes, building outlines, moving a pole with what is at it,
  inspections, an underground trace.

## Phase 3 — 10 November 2026: placement and inspector

- Placing by typed position, at a pole, by GPS or on the map, all through one checked path; inspector tabs;
  warranty, condition and maintenance; a server "possible duplicate" warning.

## Phase 2 — 10 November 2026: catalogue and inventory

- Product models with specs, catalogue rules on the server, specs per item, nothing made up when creating.

## Phase 1 — 10 November 2026: GIS foundation

- Scale bar, coordinates, show whole network, print map, snapping shown before it lands, layers from attributes,
  a layer panel with counts, opacity and labels, zone boundaries, unplaced captures drawn apart.

## Phase 0B — 10 November 2026: data integrity

- Server rules for cable ends, one-point routes and customer paths; no made-up values in fibres, inventory, zones,
  the customer and cable wizards.

## Phase 0

- The audit: [docs/NETWORK_MAPPING_AUDIT.md](docs/NETWORK_MAPPING_AUDIT.md) and
  [docs/NETWORK_MAPPING_FEATURE_MATRIX.md](docs/NETWORK_MAPPING_FEATURE_MATRIX.md).
