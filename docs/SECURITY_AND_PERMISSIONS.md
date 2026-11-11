# Security and permissions

What each person may do in FiberGIS, how the server checks it, and what the server records about every change. Phase 23 (Modules 24, 29 and 31). Login, https and backups are in [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## The short version

- Login is off until the first administrator account exists ("setup mode"). Then only the server computer can use the app, and every rule below is skipped, the same as before Phase 23. Once the first account exists, every request needs a login.
- There are **eight roles**. Each one has a fixed list of the **kinds of change** it may make (view, create, edit, move, delete, connect, disconnect, allocate, deallocate, approve, export, configure).
- The **server** checks every write. It works out what a change does from the stored record and the new one. It does not trust the app to say what the change is. The app uses the same table only to hide buttons.
- The server writes its **own audit trail** for every write, whether it came from the app, a script, an approved change request or a restore. It also keeps **earlier versions** of each record so two versions can be compared.
- A person can ask for a change they are not allowed to make. That is a **change request**. Someone with the approve right checks it, and someone allowed to make the change makes it.
- Phase 23b: one server can hold **several organisations** (ISPs). Each has its own database file, photos, voice clips and backups, and nobody in one can read or change another's. See [Organisations](#organisations-phase-23b).

## Roles

The five role names stored since Phase 9 have not changed. Existing accounts keep exactly the rights they had, with nothing changed in the database. Only the names shown on screen are new.

| Stored name | Shown as | Was called | What it is for |
|---|---|---|---|
| `admin` | Super Admin | Administrator | Everything, including user accounts, reset, restore and full backups |
| `network_admin` | Network Admin | (new) | Everything on the network, settings, approvals and monitoring sources. Not user accounts, reset, restore or full backups |
| `engineer` | GIS Engineer | Engineer | Add, change, move, connect and delete network records. Settings and lists. Cannot approve |
| `office` | Network Planner | Office staff | Plan and change records (customers, faults, jobs, network). Cannot delete network records or change settings |
| `technician` | Field Technician | Technician | Field capture, light readings and their own jobs |
| `noc` | NOC Operator | (new) | Faults, alarms and jobs. Cannot change network items |
| `supervisor` | Supervisor | (new) | Faults and jobs (give them out, close them) and approve change requests. Cannot change network items |
| `viewer` | Read-only | Viewer | Look only. Customers' names, addresses, house positions and phone numbers are hidden (Phase 12) |

Phase 12: customers' personal data is hidden by role in every server answer (Read-only sees none, a Field Technician sees it only for customers on their own open jobs, a GIS Engineer sees no phone numbers). See [CUSTOMER_FTTH_MAPPING.md](CUSTOMER_FTTH_MAPPING.md), "Personal data by role".

**Older and other spellings.** The server and the app accept other spellings of a role and store the plain name. For example, "Super Admin" and `super_admin` are stored as `admin`, "Network Planner" as `office`, "GIS Engineer" as `engineer`, "Field Technician" as `technician`, "NOC Operator" as `noc`, and "Read-only" as `viewer`. A stored role the server does not know is read as Read-only, which has the fewest rights. The `/users` routes accept the same spellings.

**The audit trail's role field.** Entries in the older audit trail (`auditLogs`) can only hold six role words. A Network Admin is written as "Administrator", a NOC Operator as "Network Operator" and a Supervisor as "Supervisor". The person's name is always written as well. The server's own audit events store the exact role.

## Kinds of change, by role

Source: `ROLE_ACTIONS` in `packages/shared/src/domain/permissions.ts`. "Some" means the role has the right only for some records (listed below the table).

| Role | View | Create | Edit | Move | Delete | Connect | Disconnect | Allocate | Deallocate | Approve | Export | Configure |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Super Admin | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Network Admin | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| GIS Engineer | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Network Planner | Yes | Yes | Yes | Yes | Some | Yes | Yes | Yes | Yes | No | Yes | No |
| Field Technician | Yes | Some | Some | Some | Some | Some | Some | No | No | No | No | No |
| NOC Operator | Yes | Some | Some | No | No | No | No | No | No | No | Yes | No |
| Supervisor | Yes | Some | Some | No | No | No | No | No | No | Yes | Yes | No |
| Read-only | Yes | No | No | No | No | No | No | No | No | No | No | No |

The "Some" limits:

- **Network Planner, delete:** only documents, and their own trips and routes.
- **Field Technician:** adds items only with Field capture (poles, boxes, faults, problem reports, Cable TV meter readings with a photo). Changes only their own jobs (not closing them, not giving them to someone else), their own field captures, and light readings on customers. Deletes only their own capture, as an undo.
- **NOC Operator:** adds and changes faults, alarms, jobs and documents. No network items, no deletes.
- **Supervisor:** adds faults, jobs and documents; changes faults, alarms, jobs and documents. Decides sync conflicts left to the office. No network items, no deletes.

Everyone can keep their own trips, Bike Mode routes and conflict records. Only a Super Admin, Network Admin or GIS Engineer may change someone else's.

Whole-network actions (`roleMay` in `access.ts`):

| Action | Who |
|---|---|
| User accounts, reset, restore, full backup, voice lessons | Super Admin |
| Monitoring sources and their push tokens | Super Admin, Network Admin |
| Import a monitoring file (CSV) | Super Admin, Network Admin, GIS Engineer, NOC Operator |
| Change settings (same as configure) | Super Admin, Network Admin, GIS Engineer |
| Send photos | Everyone except Read-only |

### How the server tells what a change does

`permissionsForChange` in `permissions.ts`, run on the server inside the write:

| The change | Kind of change needed |
|---|---|
| A record that did not exist | create |
| A record removed | delete |
| Any other change | edit, plus any of the kinds below |
| `lat`, `lng`, `coordinates` or `boundaryCoords` changed | move |
| A link added (any field naming another record, such as a cable end, a splice, a splitter port's customer, a customer's port or ONT, a span's poles) | connect |
| A link removed | disconnect |
| A core given to a use (an active core assignment, a core given to a customer), or a PON, ODF or splitter port set to Reserved | allocate |
| That taken back (assignment released, reservation removed) | deallocate |
| Anything in `settings` or `catalog` | configure as well |

Move, connect and allocate are only looked at for network records (equipment, cables, splitters, closures, customers, spans, attachments, ducts, slack loops, buildings, ONTs, services, zones and Cable TV records). A fault or a job that names a cable is not a connection. Retired splices and released assignments do not count as links. A record sent again unchanged needs no right.

When a change is refused, the reply names the record and the missing right in plain words. For example: "Field Technician accounts cannot give a core or port to a use (allocate). network item P-1 was not changed. Ask the office or an engineer, or send a change request." The details also list each refused record with `action` and `permission`.

### Export

- The server checks the export right where data leaves through an export route: `GET /api/v1/audit-events?format=csv`. A full backup needs the Super Admin (unchanged).
- In the app, the spreadsheet (CSV) and Google Earth (KML) buttons are hidden for roles without export: Field Technician and Read-only. These are the buttons in Reports, the Customer directory, the Equipment inventory, Agent tracking, KML export and (Phase 16) the map's attribute table. The table's "Change chosen" (bulk edit) shows only for roles with the edit right; the server checks every record of it in one `POST /changes`. Search (`GET /search` and the search box) finds nothing by a value hidden for the reader's role (Phase 12 personal data).
- **Limit:** the app needs the whole network to work (`GET /network`). Anyone who can log in can still read what their role can view. The export right controls the app's save-to-file buttons and the server's export routes, not reading.

## The server's audit trail

Every write through `POST /changes`, `PUT` and `DELETE /api/v1/<collection>/<id>`, an applied change request, a restore, a reset, and the monitoring routes is recorded by the server, inside the same database transaction as the change. If the change is refused, nothing is recorded, because nothing changed.

Table `audit_events`, one line per changed record:

| Column | Meaning |
|---|---|
| `seq` | Order number |
| `at` | When (server time, ISO) |
| `actor_id`, `actor_name`, `actor_role` | The logged-in person. "Setup mode (login off)" before login is on; "Server (no person)" or the monitoring source for automatic writes |
| `source` | `changes` (the app), `record` (one record by API), `change_request`, `restore`, `reset`, `monitoring`, `server` |
| `collection`, `record_id`, `op` | What changed: `create`, `update`, `delete`, or `summary` |
| `actions` | What the change did, such as `edit,move` |
| `revision` | The network revision the write made |
| `diff` | For a change: each top-level field that changed, with short before and after values (cut at 200 characters, at most 40 fields) |
| `note`, `change_request_id` | For a summary line, and for a write from a change request |

- The table is **append-only**. Database triggers refuse any `UPDATE` or `DELETE` on it, and no route writes to it except through a record write.
- A restore or reset writes one summary line per list ("Whole list replaced: 3 added, 1 changed, 0 removed, 40 unchanged"). Device readings and ONU statuses from monitoring write one summary line per write, not one per row.
- The browser's own audit entries (`auditLogs`, the Audit Trail screen) still work as before. The server still stamps them with the real person, and they cannot be changed or deleted. They are not repeated in `audit_events`.
- Read: `GET /api/v1/audit-events?collection=&id=&before=&limit=`, newest first. Any logged-in account may read it. Read-only accounts see which fields changed but not the values. Administration → Server history shows it.

## Record revisions

Table `record_revisions`: after every change, the whole record is stored (`collection`, `record_id`, `version`, `op`, `data`, `changed_at`, `actor_id`, `actor_name`, `source`). For a delete, the record is stored as it was just before. This happens in the same transaction as the write.

- `GET /api/v1/revisions/<collection>/<id>` lists the stored versions (newest first) and the record's current version.
- `GET /api/v1/revisions/<collection>/<id>/<seq>` returns one version.
- `GET /api/v1/revisions/<collection>/<id>/compare?from=<seq>&to=<seq|current>` returns the fields that differ.
- Read-only accounts get phone numbers hidden, as everywhere else.
- **Retention** (server settings): `REVISION_KEEP_DAYS` (default 365) and `REVISION_KEEP_PER_RECORD` (default 50). Older versions are removed when the server starts and then at most once an hour. The audit events are never removed.

## Change requests

Table `change_requests`. A request holds the proposed changes exactly as sent (checked against the record rules), and the version each record had when it was asked for.

| Step | Route | Who |
|---|---|---|
| Ask | `POST /change-requests` `{ title, reason?, changes }` | Anyone except Read-only. At most 500 records. Audit entries in it are dropped |
| Approve or reject | `POST /change-requests/<id>/review` `{ decision, note? }` | The approve right (Super Admin, Network Admin, Supervisor), and never the person who asked |
| Make it | `POST /change-requests/<id>/apply` | Anyone, but it runs as a normal write with **that person's** rights and every guard, so a request can never do more than the person making it could do by hand. If a record changed since the request was made, it is refused as out of date and nothing is written. A refused try is kept as a step |
| Mark as checked on site | `POST /change-requests/<id>/verify` `{ note? }` | The approve right |
| Close | `POST /change-requests/<id>/close` | The person who asked, or an approver |
| Comment | `POST /change-requests/<id>/comments` `{ text }` | The person who asked, or an approver |
| List, open | `GET /change-requests?status=`, `GET /change-requests/<id>` | Everyone except Read-only (a request can hold whole customer records) |

Statuses: requested → approved or rejected → applied → verified → closed. A request can be closed at any point. Each step is also written to the older audit trail, so it shows on the Audit Trail screen. The writes the request makes are marked with its id in `audit_events`. Administration → Change requests has the list, approve, reject, make, mark as checked and close.

## Editable lists, naming rules and custom fields

These are kept in the `settings` collection, so they sync, back up and restore with the network. Changing them needs the configure right (Super Admin, Network Admin, GIS Engineer). Administration → Lists and rules edits them, and the server checks every change (`apps/server/src/lib/settingsGuard.ts`).

- **Lists** (`list.<key>`): equipment types, equipment statuses, cable types, cable statuses, connection (connector) types and splitter ratios. The value is JSON: `{"added":[{"value","label?","group?"}],"labels":{"<value>":"<name shown>"},"hidden":["<value>"]}`.
  - A **built-in value is never removed.** It can be shown under another name, or hidden from the pickers for new items. Records that use it keep it.
  - **New values** are only accepted where the stored field takes any text: equipment types (with a category) and connector types (up to 20 characters). The other lists are fixed by the program because the checks depend on them. For example, a splitter ratio drives the loss sums. So a new value there needs a program change, and the server refuses it with that reason.
  - A value you added that records use **cannot be removed** (deleting the whole list setting counts as removing it). Hide it instead.
- **Naming rules** (`naming.<equipment|cables|closures|splitters|customers>[.<type>]`): `{"pattern":"FAT-{area}-{n:3}"}`. `{n}` or `{n:3}` is the next free number, `{area}`, `{type}` and `{yyyy}` are filled in. A rule shapes the name shown on new items. **Record ids do not change**: they stay random and permanent, because phones, links and backups rely on them. A name that does not fit the rule is a warning, never a refusal.
- **Custom fields** (`attr.<equipment|cables|customers>.<key>`): `{"label","type":"text|number|yes_no|choice|date","choices?","unit?","required?"}`. Values are kept on the record under `customAttributes`. The server refuses a value of the wrong kind, or a choice not in the list. A value whose field was later removed is kept as it is.

## The database (migration 2)

The owner approved new tables. No existing table or column was changed.

- `PRAGMA user_version` goes from 1 to 2. Migration 2 runs `CREATE TABLE IF NOT EXISTS` for `audit_events`, `record_revisions` and `change_requests`, their indexes, and the two append-only triggers. It is safe to run twice.
- An older server that opens a version 2 database sets it back to 1, as it has always done for a pre-release "2", and runs normally. It never reads the new tables. Its writes leave no audit events or revisions. The next Phase 23 start marks the database as 2 again, and its tables are kept.
- The new tables live in the same database file. They are not sent with the network and are not in backup files. A backup restore keeps them. Back up the database file itself (see the deployment guide) to keep the server's history.
- Organisations (Phase 23b): everything here works per database file and names no organisation, so each organisation's file has its own audit events, revisions and change requests, and these tables did not change.

## Organisations (Phase 23b)

The owner chose to let several ISPs use one server. Each organisation has **its own database file**, so no existing table or column changed and no row names an organisation.

**Where things live**

| What | Where |
|---|---|
| The list of organisations, which organisation each login name belongs to, and what the platform administrator did | `control.db` beside the first database (`CONTROL_DATABASE_PATH`). No network data, no passwords, no sessions |
| The first organisation: network, accounts, sessions, history, change requests, push tokens, voice clips | The database it always had (`DATABASE_PATH`), with its `photos`, `voice` and `backups` folders where they were |
| Every added organisation: the same, in its own files | `organisations/<id>/fibergis.db` with `photos/`, `voice/`, `backups/` beside it (`ORGANISATIONS_DIR`) |

**Who is in which organisation.** An account belongs to exactly one organisation: it is stored in that organisation's database file. Login names are unique on the whole server, so there is one login screen and nobody chooses an organisation. The login name list in `control.db` says where to look; it is checked against each database at start.

**Every request has one organisation.** It comes from the session: the session is stored in the account's own database, and the cookie names the organisation (`<id>.<token>`; the first organisation's cookies have no prefix, so logins made before the upgrade keep working). Changing the prefix only sends the token to a database where it does not exist. In setup mode (no account anywhere, on the server computer) it is the first organisation. The routes reach data only through stand-ins for "this request's organisation" (`scoped` in `apps/server/src/db/tenants.ts`); with no organisation they answer `401` and never fall back to another one. Photos, voice audio, backups, safety copies, restore, reset and scheduled backups use the organisation's own folders. Every rule above (roles, kinds of change, audit, revisions, change requests) applies inside the organisation, unchanged.

**Monitoring.** Sources and readings are records in the organisation's network. A push token names its organisation (`fgm_<id>.<secret>`; first organisation `fgm_<secret>`, as before), its hash is kept in that organisation's database, and a push goes to that organisation only, whoever is logged in on the device. A token's secret with another organisation's prefix is refused.

**The platform administrator** is any administrator (Super Admin) of the first organisation. In Administration, **Users and roles**, they see "Organisations on this server": they can add an organisation (its folder and database are made with every migration, plus its first administrator, who gets a temporary password shown once), rename it, and switch it off or on. Switched off: nobody in it can log in (told so only after the right password), every login in it is ended (after switching on, people log in again), its push tokens are refused; no data or account is deleted. The first organisation cannot be switched off. The platform administrator sees only names, states and account counts, never another organisation's network, people or files. Each organisation's own administrator manages only its own accounts. Platform actions are kept for good in `platform_events` in `control.db` (triggers refuse changes).

**Tests.** `apps/server/test/phase23b.test.ts`: the upgrade in place, setup mode, adding and switching off, a restart, and, from a second organisation against the first, every route family: network, changes, the changes feed, health, reports, single records, the map area, audit events, revisions, change requests, photos, backup, restore, reset, safety copies, monitoring sources, push tokens and ingest, voice clips and audio, accounts and technicians, and moved session cookies.

## Code

| Part | File |
|---|---|
| Roles, labels, other spellings, per-collection rules, the write check | `packages/shared/src/domain/access.ts` |
| Role × kind-of-change table, working out what a change does | `packages/shared/src/domain/permissions.ts` |
| Audit event and revision types, field differences | `packages/shared/src/domain/recordHistory.ts` |
| Change request rules and steps | `packages/shared/src/domain/changeRequests.ts` |
| Lists, naming rules, custom fields | `packages/shared/src/domain/editableLists.ts` |
| Migration 2, writes recorded in the same transaction | `apps/server/src/db/sqliteRepository.ts`, `historyStore.ts`, `changeRequestStore.ts` |
| Who is writing, `requireAction` | `apps/server/src/auth/access.ts` |
| Audit, revision and change request routes | `apps/server/src/routes/governance.ts` |
| List, rule and custom field checks | `apps/server/src/lib/settingsGuard.ts` |
| Screens | `apps/web/src/features/admin/ChangeRequestsPanel.tsx`, `RecordHistoryPanel.tsx`, `ListsRulesPanel.tsx`, `UsersPanel.tsx` (role table) |
| Phase 23b organisations: control database, organisations, request's organisation, token and cookie prefixes | `apps/server/src/db/controlStore.ts`, `apps/server/src/db/tenants.ts`, `apps/server/src/app.ts` (session hook) |
| Phase 23b routes and screen | `apps/server/src/routes/organisations.ts`, `apps/server/src/routes/auth.ts` (login across organisations), `apps/web/src/features/admin/OrganisationsPanel.tsx` |
| Tests | `apps/server/test/phase23.test.ts` (every role × every kind of change on the server, audit trail for direct API writes, revisions, migration, change requests, lists), `packages/shared/test/permissions.test.ts`, `apps/web/src/stores/authStore.test.ts` |

## Known limits

- The pickers in other screens (equipment type, cable type and so on) do not read the editable lists yet. They still offer the built-in values, so hidden values and new names are not shown there. `pickerEntries()` is ready for them. Naming rules are not yet used when new items are made, and custom fields cannot yet be filled in on the item screens. The data, the rules and the server checks are in place.
- The browser cannot tell whose capture a record is, so the server stays the last word on a technician's "own" captures.
- The NOC Operator and Supervisor rules do not yet cover collections added by other phases after Phase 23 (for example inspections, and the Phase 13 link checks). They cannot change those until a rule is added.
- Link checks (`linkVerifications`, network mapping Phase 13) are field evidence, like inspections: a Field Technician may add one and change or delete only their own; Read-only cannot add any. Recording a check is not a `connect`: the collection is deliberately not one of the network collections, so it needs only `create` or `edit`. See [PHYSICAL_CONNECTIVITY.md](PHYSICAL_CONNECTIVITY.md).
- Map check findings (`validationFindings`, network mapping Phase 15) are run and marked fine or fixed by Super Admin, Network Admin, GIS Engineer and Network Planner. Field Technician, NOC Operator, Supervisor and Read-only can read them. Nobody can delete one: the server refuses it, as a finding is history. Like link checks, the collection is not one of the network collections, so a decision needs only `create` or `edit`. Findings name customers by id only and never hold a house position, so every role may read them. See [NETWORK_VALIDATION.md](NETWORK_VALIDATION.md).
- Planning scenarios (`planningScenarios`, network mapping Phase 18) are plans, not network records: Network Planner, GIS Engineer, Network Admin and Super Admin may add and change them, and the Network Planner may also delete them. Field Technician, NOC Operator, Supervisor and Read-only cannot write them. See [CAPACITY_PLANNING.md](CAPACITY_PLANNING.md).
- Organisations (Phase 23b): there is one Sarvam voice key for the server, but its daily character limit (`SARVAM_DAILY_CHAR_LIMIT`) is counted per organisation, so the server's total can be the limit times the number of organisations, and each organisation makes (and pays for) its own clips. Server settings (`.env`) are shared by all organisations. There is no screen yet to move an organisation to its own server; copy its folder (see the deployment guide). Organisations are never deleted from the screen.
