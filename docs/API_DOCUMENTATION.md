# FiberGIS API

Every route is under `/api/v1` (`API_PREFIX` in `packages/shared/src/model/api.ts`). Requests and answers are JSON unless said otherwise. The shapes are the TypeScript types and zod schemas in `@fibergis/shared` (`packages/shared/src/model/`), which the web app uses too. This page lists the routes as of Phase 24.

## Rules for every request

- **Login.** Login is off until the first administrator account exists ("setup mode"); then only the server computer itself (`localhost`) may use the API. Once an account exists (or `AUTH_REQUIRED=true`), every route needs the session cookie except `/health`, `/auth/status`, `/auth/login`, `/auth/setup`, `/auth/logout` and `/monitoring/ingest`. Without one: `401 login_required`. A temporary password must be changed first (`403 password_change_required`).
- **Permissions.** Writes are checked against the account's role and its action permissions inside the write ([SECURITY_AND_PERMISSIONS.md](SECURITY_AND_PERMISSIONS.md)); a refusal is `403` with the problems listed. Look-only accounts (`viewer`) get customers' phone numbers hidden and no sync conflict records, in every read below.
- **Other websites.** A `POST`, `PUT`, `PATCH` or `DELETE` from another site (or the origin `null`) is refused (`403`).
- **Limits.** `RATE_LIMIT_PER_MINUTE` per session (or address). Bodies up to 1 MB unless a route says more.
- **Errors** are `{ error, message, issues?, conflicts?, ... }` (`ApiErrorBody`). `400 validation_error` lists the first 20 problems; `409 version_conflict` lists each record someone else changed, with the version now stored; `409 link_error`, `settings_refused` and others say in plain words why nothing was saved.
- **Caching.** Answers that describe the network are sent with `cache-control: no-store`.

## Health

| Route | What it does |
|---|---|
| `GET /health` | `{ status, version, uptimeSeconds }`; with a login (or on the server computer in setup mode) also `revision` and `counts` per collection. Not rate limited. |

## The network

| Route | What it does |
|---|---|
| `GET /network` | The whole network: `{ revision, data, versions }` (`NetworkResponse`). `data` has one array per collection; `versions` the version of every record (Phase 8). |
| `GET /network?except=equipment,cables` | Phase 24b. Every collection except the named ones, in full, with their versions, read at one revision (`RecordsResponse`): `{ revision, data, versions }`. A collection absent from `data` was not asked for (it is not empty). Same personal-data hiding as `GET /network`. `400` for an unknown collection. |
| `GET /network/records?ids=a,b&collections=equipment,cables` | Phase 24b. The stored records with these ids (at most 1,000) in these collections (default: all), with their versions (`RecordsResponse`). Ids not stored are left out. A device loading by map area uses it for the records the loaded ones point to and for what the server search found. Same hiding as `GET /network`. `400` without `ids`, for more than 1,000, or an unknown collection. |
| `GET /network/area?bbox=south,west,north,east` | Phase 24. Only the records whose point, line or area touches the box (`AreaResponse`): `{ revision, bbox, data, versions, truncated, limit }`. `data` has only the collections with records in the box; records with no map position are never in it. A span counts by the line between its two poles. Options: `collections=equipment,cables` (only these), `limit` (most records, 1 to 100,000; default 20,000; `truncated: true` when more touch the box). `400` for a box that is not four numbers in range with south <= north and west <= east (a box across the 180° line is not supported). |
| `GET /search?q=<words>` | Phase 16. Typed hits for names, ids, serials, models, QR tags, pole numbers, a fibre (`CBL-01/5`, `CBL-01 fibre 5`), PON ports (`0/1/3`, `OLT-01/PON-3`), ODF adapters (`A/12`), splitters, closures, ducts, spans, zones, ONTs, buildings and slack loops: `{ revision, query, total, offset, limit, hits, nextCursor? }`. Each hit has `kind`, `collection`, `id`, `part` (fibre number or port id), `label`, `matched: { field, value }` (the field that matched, as written) and `detail`. Options: `kinds=cable,pole` (see `SEARCH_KINDS`), `limit` (1 to 500, default 50), `cursor` (the `nextCursor` or `x-next-cursor` of the page before). Searches the organisation's network after the same redaction as `GET /network` (a hidden value cannot be found); customers' phone numbers are never searched. The web app's search box runs the same `searchNetwork` on its copy. `400` without `q`, for more than 200 characters or an unknown kind. |
| `GET /changes?since=<revision>` | Phase 24. What was stored or deleted after that revision (`ChangesResponse`): `{ revision, since, upserts, deletes, versions }`, `upserts` and `versions` per collection, `deletes` a list of ids per collection. Applying them to the network as it was at `since` gives the network at `revision`. When the history does not reach back that far (a restore or reset since, a very long time away, or a revision newer than the server has), the answer is `{ revision, since, reload: true, reason }`: load `GET /network` instead. `400` without a whole-number `since`. |
| `POST /changes` | Writes a change set atomically (`ChangeSet`): `{ upserts?, deletes?, expect? }`, with whole records per collection and ids to delete. `expect` gives the version each record was edited from; if someone else changed it since, the whole set is refused with `409 version_conflict`. Each record is checked against its schema; links, fibers, connections, faults, Cable TV, catalogue, sites and racks, settings and permissions are checked against the stored network in the same transaction. Answer `ChangeResult`: `{ revision, upserted, deleted, versions, warnings? }` (warnings such as a possible duplicate point never block). Body up to 10 MB. |
| `GET /backup` | The whole network as a JSON backup file (`NetworkBackup`). `?photos=1`: a zip with `backup.json` and every photo. Needs the `backup` right. |
| `POST /restore` | Replaces the collections in a backup (JSON, or the zip as `application/zip`). Checked first: problems the stored network does not already have refuse it with `409 restore_refused` and a list, unless `?accept=problems`. A safety copy is saved first. Needs the `restore` right. Up to `RESTORE_MAX_MB`. |
| `POST /reset` | Puts the demo network back (the catalogue is kept). Needs `{ "confirm": "reset" }` and the `reset` right. A safety copy is saved first. |
| `GET /connections?element=<id>` or `?cable=<id>&core=<n>` | Network mapping Phase 13. Read-only: every recorded link of one record (equipment, cable, splitter, closure, customer, ONT, Cable TV item) or of one fibre, from the connection index ([PHYSICAL_CONNECTIVITY.md](PHYSICAL_CONNECTIVITY.md)). `{ revision, element | cable+core, connections, checksOfLinksNotOnRecord }`. Each connection has `id`, `kind`, `from` and `to` (typed ends with words and `onRecord`), `state`, `recordedIn`, `recordedBy`/`recordedAt` only when recorded, `warnings`, `check` (`state` is `not_checked`, `passed`, `failed`, `inconclusive` or `changed_since_check`; `label`, `hasEvidence`, `count`) and `checks` (newest first). Built after the same personal-data hiding as `GET /network` (Phase 12), from this organisation only. `400` unless exactly one of the two forms is given. Checks are written as `linkVerifications` records through `POST /changes`. |

## Records of one collection

`<collection>` is any collection name (`equipment`, `cables`, `customers`, ...; see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)). An unknown name is `404`.

| Route | What it does |
|---|---|
| `GET /<collection>` | Every record of the collection, in stored order, as before. |
| `GET /<collection>?limit=&cursor=&ids=&bbox=&changedSince=` | Phase 24. Still an array of records, in stored order, with any of: `limit` (records per page, 1 to 10,000; default 10,000 when another filter is given), `cursor` (the `x-next-cursor` of the page before), `ids=a,b,c` (at most 1,000), `bbox=south,west,north,east` (records touching the box), `changedSince=<revision>` (records stored after that revision). Headers: `x-network-revision` (the revision it was read at) and `x-next-cursor` (absent on the last page). A cursor is a stored position: after a restore, start again. |
| `GET /<collection>/<id>` | One record. Headers `x-record-version` and `etag`. `404` when it does not exist. |
| `PUT /<collection>/<id>` | Stores one record (the same checks as `POST /changes`). `If-Match: <version>` refuses it when someone else changed it since (`409 version_conflict`). `201` when new, `200` when replaced; headers `x-network-revision`, `x-record-version`. Body up to 2 MB. |
| `DELETE /<collection>/<id>` | Deletes one record (the same checks). `If-Match` as above. `204`; `404` when it does not exist. |

## Login and accounts (Phase 9)

| Route | What it does |
|---|---|
| `GET /auth/status` | Whether login is on, setup mode, and the account logged in. |
| `POST /auth/setup` | Creates the first administrator (needs `SETUP_TOKEN` when set). |
| `POST /auth/login`, `POST /auth/logout` | Start or end a session (cookie). Wrong passwords are limited (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`). |
| `POST /auth/password` | Change one's own password. |
| `GET /auth/technicians` | Shown names of the technicians, for giving out jobs. |
| `GET /users`, `POST /users`, `PATCH /users/<id>`, `POST /users/<id>/password` | Accounts. Administrator only. A new account or a reset gives a temporary password, shown once. |

**Organisations (Phase 23b).** Every route above and below works on the organisation of the session (or, in setup mode, the first organisation); no route reads or writes another organisation. `GET /auth/status` also gives `organisation` (`id`, `name`) and `platformAdmin: true` for an administrator of the first organisation. Login names are unique on the whole server (`409 username_taken`). An account of a switched-off organisation gets `403 organisation_suspended` at login (only after the right password), and switching an organisation off ends its sessions. Platform administrator only (`403` for anyone else, `409 setup_mode` before the first account):

| Route | What it does |
|---|---|
| `GET /platform/organisations` | Every organisation (`id`, `name`, `status` `active` or `suspended`, `host`, `createdAt`, `updatedAt`, `activeAccounts`) and the latest platform events. No network data, no accounts. |
| `POST /platform/organisations` | `{ "name", "admin": { "username", "displayName", "password"? } }`. Makes the organisation's folder and database and its first administrator (who must choose their own password at first login). Without `password`, a temporary one comes back once as `temporaryPassword`. `409 name_taken` or `username_taken`. |
| `PATCH /platform/organisations/<id>` | `{ "name"?, "status"? }`: rename, switch off (`suspended`) or on (`active`). The first organisation cannot be switched off (`409 host_stays_on`). |

## History and change requests (Phase 23)

| Route | What it does |
|---|---|
| `GET /audit-events` | The server's audit events, newest first. `collection`, `id`, `before` (sequence number, for paging back), `limit`; `format=csv` needs the `export` right. |
| `GET /revisions/<collection>/<id>` | The stored versions of one record. `/<seq>`: one version. `/compare?from=<seq>&to=<seq or current>`: the fields that differ. |
| `GET /change-requests`, `GET /change-requests/<id>` | Requests (`status` filter) and one request. |
| `POST /change-requests` | Ask for a change (a change set with a title and reason). |
| `POST /change-requests/<id>/review`, `/apply`, `/verify`, `/close`, `/comments` | Approve or reject; make it (the same checked write as any change, with the rights of the person applying it); mark it checked; close it; add a comment. `403` when the role may not take the step, `409` when the request is not at that point. |

## Live monitoring (Phase 7)

| Route | What it does |
|---|---|
| `POST /monitoring/ingest` | Rows from a device source, with `Authorization: Bearer <token>`. The token can only send rows. `INGEST_PER_MINUTE` per source; at most 2000 rows and 512 KB. See [MONITORING_ADAPTERS.md](MONITORING_ADAPTERS.md). Phase 23b: the token names its organisation (`fgm_<organisation id>.<secret>`; the first organisation's tokens are `fgm_<secret>` as before), and the rows go to that organisation only, whoever is logged in on the device; a switched-off organisation's tokens get `401`. Phase 20: the body may carry `devices` (OLT, card, PON port and uplink status rows) beside `rows`, at least one row in all; the answer then has a `devices` part (stored, matched, duplicates, skipped, not matched). |
| `GET /monitoring/sources`, `POST /monitoring/sources`, `PATCH /monitoring/sources/<id>` | Sources. Changes need `manage_monitoring`. |
| `POST /monitoring/sources/<id>/token`, `DELETE /monitoring/sources/<id>/token` | A new push token (shown once), or revoke it. |
| `POST /monitoring/import` | A file of readings (`import_monitoring`). |
| `POST /monitoring/simulate` | The TEST simulator (`manage_monitoring`); everything it makes is marked TEST. |

## Photos, voice, reports, routing

| Route | What it does |
|---|---|
| `PUT /photos/<id>`, `GET /photos/<id>` | Field photos (JPEG, PNG or WebP, at most 5 MB, bytes checked). A stored photo is never replaced. Upload needs `upload_photo`. |
| `GET /voice/scripts`, `GET /voice/clips`, `POST /voice/generate`, `POST /voice/clips/<id>/review`, `GET /voice/audio/<id>` | Voice lessons. Generating and reviewing need `manage_voice`. |
| `GET /reports/data-quality` | The map check summary (rules, counts, example ids). Network mapping Phase 15: the `fibergis-map-check` rules plus the geometry rules, with the operator's own limits from the settings records (never only the script's defaults). Any signed-in account. |
| `POST /reports/validation-run` | Network mapping Phase 15. Runs the same check and stores what it finds as `validationFindings` records: new problems are opened, problems found again keep their finding, findings not found are marked "no longer found"; nothing is deleted. Written through the normal guarded write, so it is audited and needs the right to add and change findings (Super Admin, Network Admin, GIS Engineer, Network Planner); others get `403`. `{ revision, checkedAt, written, summary: { found, opened, foundAgain, reopened, noLongerFound, unchanged }, counts }`. Marking a finding fine or fixed is a `validationFindings` upsert through `POST /changes`; a delete, a decision without who, when and a note, or history rewritten is refused (`409`). See [NETWORK_VALIDATION.md](NETWORK_VALIDATION.md). |
| `POST /routing/route` | A road route between 2 to 25 points (`RouteRequest`), from the OSRM server set in `OSRM_URL`. |

## Keeping a device in step (Phase 24)

The web app loads `GET /network` once, then every 30 seconds asks `GET /health` for the revision. When it differs, it asks `GET /changes?since=<its revision>` and merges the answer the same way as a whole load (records with unsent local edits keep the local version until they are sent, and the version check on that send finds any clash, as before). On `reload: true`, on an older server without the route, or on an unreadable answer it loads `GET /network` as before. After its own write, if someone else wrote in between, it asks for the changes since the revision it had before that write.

**Phase 24b: big networks by map area.** When `GET /health` counts 30,000 or more records in `equipment`, `cables`, `customers`, `spans`, `ducts`, `slackLoops` and `buildings` together (and the device is not set to "whole network"), the web app does not ask for `GET /network`. It asks, at the same time, for `GET /network?except=<those seven>` and `GET /network/area?bbox=<the screen, grown by half on each side>&collections=<those seven>`, then `GET /network/records?ids=` for the records the loaded ones name and does not hold (a cable's far end, a span's poles, a customer's box; one step, at most 3,000 ids). When the map stops moving (0.4 s) on a place not loaded yet, it asks for that area the same way; loaded records are added, none taken away. The reads come at slightly different revisions, so it then asks `GET /changes?since=<the oldest>`, which brings every record it holds, inside or outside the areas, to one revision; deletes are applied wherever the record is. A full reload (start, back online, discard, restore) keeps of those seven collections only the area in view and the records with unsent edits. A truncated area is not counted as loaded, so zooming in asks again. In the search box it also asks `GET /search` and loads the hits it lacks. With no `GET /network/area` or `GET /network/records` (an older server, `404`) it loads `GET /network` as before.
