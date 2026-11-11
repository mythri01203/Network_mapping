# FiberGIS database schema

The server keeps everything in one SQLite file (`DATABASE_PATH`, default `apps/server/data/fibergis.db`), opened with `node:sqlite` in WAL mode. Field photos and voice clips are files in folders beside it (`photos/`, `voice/`); backups go to `backups/`. This page lists every table as of Phase 24 (schema number 3).

**Back up the file, its `-wal` file and the `photos` folder together**, or use the backup with photos (`GET /api/v1/backup?photos=1`, or the scheduled backups in [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)).

**Several organisations (Phase 23b).** Each organisation has its own database file with every table below, unchanged. A small control database lists the organisations; see [Organisations](#organisations-phase-23b-controldb) at the end.

## Schema number and migrations

`PRAGMA user_version` counts the migrations applied. Each one only adds tables (`IF NOT EXISTS`) and can run twice; none changes a table or column that is already there. A server refuses to open a file whose number is higher than it knows.

| Number | Phase | What it adds |
|---|---|---|
| 1 | first release | `records`, `meta` |
| 2 | 23 | `audit_events` (append-only), `record_revisions`, `change_requests` |
| 3 | 24 | `record_bounds` and `record_bounds_rtree` (spatial index, rebuilt from `records` by the migration), `change_log`, and the `change_log_floor` row in `meta` |

Added without changing the number (an older server can still use the file, see each table): the `version` column (Phase 8) and `created_by` column (Phase 9) of `records`; `users`, `sessions` (Phase 9); `monitoring_tokens` (Phase 7); `voice_clips`.

**Going back to an older server after Phase 24:** a Phase 23 server stops at start with "Database schema v3 is newer than this server supports". This is on purpose: an older server would write without keeping the change log and the spatial index, and phones would then miss changes. Keep the copy of the database made before the upgrade, or restore a backup into the older server.

## The network: `records` and `meta`

| Table | Columns | Notes |
|---|---|---|
| `records` | `collection` TEXT, `id` TEXT, `position` INTEGER, `data` TEXT (JSON, checked with `json_valid`), `updated_at` TEXT, `version` INTEGER (Phase 8, default 0), `created_by` TEXT (Phase 9) | One row per record of every collection. Primary key `(collection, id)`, `WITHOUT ROWID`. Index `records_by_position (collection, position)`: records keep the order they were first stored in; an update does not move them. `version` is the network revision of the write that last stored the record. `created_by` is the account that first stored it (kept through a restore). |
| `meta` | `key`, `value` | `revision`: the network revision, raised by one for every write that stores or deletes anything. `change_log_floor` (Phase 24): the oldest revision `GET /changes` can answer from. |

The collections (one per key of `COLLECTION_SCHEMAS` in `packages/shared/src/model/collections.ts`; each record is checked against its zod schema before it is stored) are: `equipment`, `cables`, `splitters`, `closures`, `customers`, `faults`, `workOrders`, `auditLogs`, `zones`, `documents`, `catalog`, `gpsRoutes`, `agentTrips`, `settings`, `spans`, `attachments`, `ducts`, `slackLoops`, `permissions`, `onts`, `services`, `buildings`, `alarms`, `syncConflicts`, `rfElements`, `rfLinks`, `rfLevels`, `monitoringSources`, `onuReadings`, `onuStatuses`, `deviceStatuses` (network mapping Phase 20: OLT, card, PON port and uplink status from a push source), `inspections`, `sites`, `racks` (Phase 9, ODF work), and any added since. A new collection needs no table change.

## History and review (Phase 23)

Written by the server in the same transaction as each write; nothing in the browser can write them. Not in a backup file. Details in [SECURITY_AND_PERMISSIONS.md](SECURITY_AND_PERMISSIONS.md).

| Table | Columns | Notes |
|---|---|---|
| `audit_events` | `seq` (autoincrement), `at`, `actor_id`, `actor_name`, `actor_role`, `source`, `collection`, `record_id`, `op` (create, update, delete, summary), `actions`, `revision`, `diff` (JSON), `note`, `change_request_id` | Who changed which record, when, how and which fields. Triggers refuse any update or delete: kept for good. Index `(collection, record_id, seq)`. |
| `record_revisions` | `seq`, `collection`, `record_id`, `version`, `op`, `data` (JSON), `changed_at`, `actor_id`, `actor_name`, `source` | The whole record after each change, for comparing versions. Pruned by `REVISION_KEEP_DAYS` and `REVISION_KEEP_PER_RECORD`. Indexes by record and by time. |
| `change_requests` | `id`, `title`, `reason`, `status`, `changes` (JSON change set), `base_versions` (JSON), requested/reviewed/applied/verified by, name and time, `review_note`, `applied_revision`, `closed_at`, `events` (JSON), `updated_at` | Changes waiting for review, approved, made and checked. Index `(status, requested_at)`. |

## Map positions and incremental sync (Phase 24)

Hold nothing that is not in `records`, so they are never backed up; migration 3 rebuilds the spatial index from `records`.

| Table | Columns | Notes |
|---|---|---|
| `record_bounds` | `rid` INTEGER PRIMARY KEY, `collection`, `id` (unique together) | Names each record that has a map position. |
| `record_bounds_rtree` | `rid`, `min_lat`, `max_lat`, `min_lng`, `max_lng` | SQLite R-tree: the smallest box around the record (rounded outwards). `GET /network/area` and `GET /<collection>?bbox=` ask it for candidates, then test each record's real point, line or area against the box. |
| `change_log` | `collection`, `id`, `revision`, `deleted` (0 or 1) | One row per record: the revision of the last write that stored (`deleted` 0) or deleted it (`deleted` 1, a tombstone). Primary key `(collection, id)`, `WITHOUT ROWID`; index by `revision`, and a partial index of the tombstones. |

**What has a map position.** Read from the record itself, whatever its collection: top-level `lat` and `lng` (equipment, customers, closures, buildings, slack loops, and new collections such as sites); a top-level object holding `lat` and `lng` (a fault's `affectedLocation`); a line in `coordinates` or `routePoints` (cables, ducts, GPS routes); an area in `boundaryCoords` or `footprint` (zones, building outlines); a trip's `points`. A span is the line between its two structures (and its bends), so when a pole moves or goes, its spans' boxes are redrawn in the same write. Values outside the earth's range are ignored, never guessed. Records with none of these (settings, the catalogue, audit entries, attachments, ONTs without a position) are not in the index.

**Kept in step.** Every write (`POST /changes`, `PUT`/`DELETE /<collection>/<id>`, monitoring, change requests) marks each stored or deleted record in `change_log` and updates its box, inside the write's own transaction. A restore or reset replaces whole lists: their boxes are rebuilt and `change_log_floor` is raised to the restore's revision, so every device loads the whole network once.

**Phase 24b: no schema change.** `GET /network?except=` and `GET /network/records?ids=` read `records` only (the second by its `(collection, id)` key). A browser that loads a big network by map area keeps the same offline copy as before (IndexedDB, Phase 19); its sync note gains `mode: "area"`, so the device says "part loaded" also when it starts offline.

**Tombstones.** At most 200,000 are kept; beyond that the oldest are removed (counted at start and at most once an hour) and `change_log_floor` moves up to the newest one removed. A device further behind than the floor is told to reload.

## Accounts, tokens and clips

| Table | Columns | Notes |
|---|---|---|
| `users` | `id`, `username` (unique), `display_name`, `role`, `password_hash`, `active`, `must_change_password`, `created_at`, `updated_at`, `last_login_at`, `password_changed_at` | Phase 9. Passwords are stored only as hashes. |
| `sessions` | `token_hash` (primary key), `user_id`, `created_at`, `expires_at`, `last_seen_at` | Phase 9. The cookie holds the token; only its hash is stored. Index by user. |
| `monitoring_tokens` | `source_id` (primary key), `token_hash` (unique), `created_at`, `created_by`, `last_used_at` | Phase 7. Push tokens for monitoring sources, hashed; shown once. |
| `voice_clips` | `id`, `lesson_key`, `language`, `script_hash`, `model`, `voice`, `characters`, `bytes`, `format`, `status`, `created_at`, `created_by`, `reviewed_at`, `reviewed_by` | Voice lessons. The audio is a file in the `voice` folder. Index `(lesson_key, language)`. |

## Organisations (Phase 23b): `control.db`

A separate small SQLite file (`CONTROL_DATABASE_PATH`, default `control.db` beside `DATABASE_PATH`), with its own schema number (`PRAGMA user_version` 1). New tables only, in a new file; no table or column of an organisation's database changed, and no row there names an organisation. The `users` and `sessions` tables above stay in each organisation's own file.

| Table | Columns | Notes |
|---|---|---|
| `organisations` | `id` (`ORG-` and 10 letters or digits, also the folder name), `name`, `status` (`active` or `suspended`), `is_host` (1 for the first organisation, at most one), `created_at`, `updated_at` | One row per organisation. The first one is the database at `DATABASE_PATH`, registered in place on the first start after the upgrade. |
| `organisation_logins` | `username` (primary key), `organisation_id`, `user_id` | Which organisation each login name belongs to, so login names are unique on the server and the one login screen knows where to look. Checked against every organisation's `users` at start (missing names added, names no longer there removed). |
| `platform_events` | `seq`, `at`, `actor_id`, `actor_name`, `action` (`ORGANISATION_ADDED`, `ORGANISATION_RENAMED`, `ORGANISATION_SWITCHED_OFF`, `ORGANISATION_SWITCHED_ON`), `organisation_id`, `details` | What the platform administrator did. Triggers refuse any update or delete. |

**Folders.**

```
data/                         (beside DATABASE_PATH)
  fibergis.db  -wal  -shm     first organisation (unchanged)
  photos/  voice/  backups/   first organisation's files (unchanged; PHOTOS_DIR, VOICE_DIR, BACKUPS_DIR still apply to it)
  control.db                  the organisations list (new)
  organisations/              ORGANISATIONS_DIR (made when the first one is added)
    ORG-XXXXXXXXXX/
      fibergis.db             the same tables as above, all migrations
      photos/  voice/  backups/
```

An organisation's database is never made in place of a missing one: if its `fibergis.db` is gone, the server logs a warning and does not open it. A folder under `organisations/` that is not in `control.db` is reported and left alone.
