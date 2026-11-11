# Deploying FiberGIS

This covers what the phone capture flow (`/capture`, Phase 2) needs. The rest of the app runs as described in the README.

**Not yet tested on a real phone or with field workers.** Everything below was checked in desktop Chrome with a simulated phone (360 x 740), a fake camera and simulated GPS.

## Phones need https

Browsers give the camera and GPS only to a **secure** page: `https://...`, or `http://localhost` on the same device. A phone opening `http://192.168.x.x:5000` over the office Wi-Fi is not secure, so:

- the live camera view and GPS are blocked (the capture screens then say "This address is not secure (no https). Camera and location will not work. Tell the office.");
- the offline app shell (service worker) does not start.

Pick one of these.

### A. Real deployment: a reverse proxy with a certificate (recommended)

Put the API server behind a web server that handles https, such as Caddy or nginx, on a domain name you control. Caddy gets a free certificate by itself:

```
fibergis.example.in {
    reverse_proxy 127.0.0.1:5000
}
```

Then build and start the app (`npm run build`, then `npm start`) and open `https://fibergis.example.in/capture` on the phone. **Create the first administrator account (see "Login" below) before the address is reachable by anyone else**, and set `TRUST_PROXY=1` so the server sees the real https address and client IP (needed for secure cookies and for the login limit).

The server can also serve https itself: set `HTTPS_CERT_FILE` and `HTTPS_KEY_FILE` to a certificate and key. Keep key files out of the repository (`certs/` is git-ignored).

### B. Testing on the office network: `dev:https` (opt-in)

`npm run dev:https -w @fibergis/web` starts the Vite dev server over https on port 5173. The normal `npm run dev` is unchanged. It needs a certificate the phone trusts:

1. Install [mkcert](https://github.com/FiloSottile/mkcert), then run `mkcert -install`.
2. From the repository root: `mkdir certs`, then `mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem <your-computer-LAN-IP> localhost`.
3. Copy mkcert's root certificate (`mkcert -CAROOT` shows the folder; the file is `rootCA.pem`) to the phone and install it (Android: Settings, Security, Encryption and credentials, Install a certificate, CA certificate).
4. Start the API (`npm run dev:server`) and then `npm run dev:https -w @fibergis/web`. Open `https://<your-computer-LAN-IP>:5173/capture` on the phone.

`certs/` is git-ignored. Never commit the key. Other paths can be given with the environment variables `FIBERGIS_HTTPS_CERT` and `FIBERGIS_HTTPS_KEY`. The dev server has no service worker, so offline opening cannot be tested this way; use option A or C for that.

### C. A quick look on one Android phone

In Chrome on the phone, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<your-computer-LAN-IP>:5000`, and restart Chrome. This is for a trial only; do not ask field staff to do it.

## Offline app shell

The production build writes `apps/web/dist/sw.js` from the hand-written template `apps/web/sw/service-worker.js`. It is registered only in production builds and only on secure pages. At install it stores every built file (JavaScript, styles, the Telugu and Kannada fonts, the QR decoder) and `index.html`, so after one visit with signal the app opens with none.

- **Stored:** the app, fonts, QR decoder, the map stylesheet, and any recorded audio clips listed in `public/audio/manifest.json`.
- **Not stored:** map pictures (tiles), and every `/api/` answer. Offline, the capture summary says "The map picture needs internet. Your work is still saved on the phone."
- **Updates:** a new build changes the worker's version. The phone picks it up on the next visit with signal and uses it once every FiberGIS tab has been closed.
- The web manifest (`public/manifest.webmanifest`) opens `/capture` when the app is added to the home screen.

## Photos

Field photos are compressed on the phone (longest side 1280 px, JPEG quality about 0.7), kept in the phone's IndexedDB, and uploaded by a separate queue with retries. The server stores each as a file:

- **Where:** a `photos` folder beside the database file (`apps/server/data/photos/` by default), or `PHOTOS_DIR` if set.
- **API:** `PUT /api/v1/photos/<id>` (JPEG, PNG or WebP, at most 5 MB, bytes checked against the type; repeating an upload stores nothing new) and `GET /api/v1/photos/<id>`.
- **Backup:** the backup with photos (a zip, see "Backups and restore") includes them; the plain JSON backup does not. Back up the `photos` folder with the database file as well.
- Records point at photos by id; a stored photo is never replaced.
- Job photos from **My jobs** (`/jobs`, Phase 8) use the same queue and folder.

## Database upgrade (Phase 8)

The first start of a Phase 8 server adds a `version` column to the records table. It changes no record and no revision, and it leaves the schema number (`user_version`) at 1, so an older server can still open the database; writes made by an older server do not change a record's version, so a version check cannot see them. Copy the database file (and its `-wal` file, if present) before the first start anyway. Clients that do not send versions keep working as before.

## Settings for the field

Administration, **Field capture settings**: GPS accept and warn limits, readings to average, how long to wait before offering "office will place it", the "same one?" search radius, light meter decimals and plausible range, and the supervisor's phone number (the **Call supervisor** button stays hidden until it is set). All limits are proposals from `fibergis-osp-mapping`; test them on your own streets.

## Login (Phase 9)

**Setup mode.** A server with no user accounts runs with login off, and the screen shows "Login is off — create the first admin account". Login being off works **only on the server computer itself** (opened as `http://localhost`): every other phone or computer sees "Logins are not set up yet" and can neither read nor change anything, and whatever it has saved stays on it until someone logs in. The server log says so at start. Do this straight away:

1. On the server computer, open the app, go to Administration, **Users and roles**, and create the first administrator account. Login is on from that moment, for every device.
2. Add an account for each person with the right role: **admin** (everything, including users, reset and restore), **engineer** (network design), **office** (customers, faults, work orders), **technician** (their own jobs and field capture; cannot delete network records), **viewer** (look only; phone numbers hidden).
3. New accounts get a temporary password, shown once. The person must set their own at first login; the server allows nothing else until then.
4. Each account needs its own shown name (two "Ravi"s are refused): jobs are given to technicians by that name.

If the server computer has no screen, set `SETUP_TOKEN`: the first administrator can then be made from another device's login screen with that code. `AUTH_REQUIRED=true` turns setup mode off altogether.

**What else the server enforces:** a reset always needs its confirm word; changes from another website (including a sandboxed page) are refused; a light reading marked "reported by the device" can come only from the monitoring connection; trips, routes and conflict records belong to the person who made them (an engineer or the administrator may change anyone's; the office may record its decision on a conflict); unsent changes on a shared phone are sent only under the login of the person who made them; logging out removes the stored network copy from the device when nothing is waiting; a restore never removes audit entries. `/health` gives counts and the revision only to someone logged in.

**Nobody can log in?** On the server's own computer: `npm run user -w @fibergis/server -- list`, and `npm run user -w @fibergis/server -- reset-password <login name>`, which prints a temporary password once. Phase 23b: both cover every organisation (the list shows which one), and `npm run user -w @fibergis/server -- organisations` lists the organisations.

**Unsent work is kept.** If a phone's session ends while it holds unsent changes, the app asks the person to log in again and then sends them.

| Setting | Default | What it does |
|---|---|---|
| `AUTH_REQUIRED` | `false` | `true`: login is required even before the first account exists |
| `SETUP_TOKEN` | not set | Code needed to create the first administrator |
| `SESSION_DAYS` | 30 | How long a login lasts without use (it is extended while in use) |
| `SESSION_MAX_DAYS` | 90 | A login ends this long after it began, however much it is used |
| `PASSWORD_MIN_LENGTH` | 8 | Shortest allowed password |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES` | 5, 15 | Wrong passwords allowed per name and address before waiting, and how long. Also 4× per address and 10× per name from anywhere. Each try is counted before the password is checked, so tries sent all at once are limited too |
| `RATE_LIMIT_PER_MINUTE` | 1200 | Requests per minute per address |
| `COOKIE_SECURE` | `auto` | Secure cookies when the request came over https |
| `TRUST_PROXY` | not set | Trust a reverse proxy's forwarded address and protocol. Prefer the proxy's address or a hop count (`127.0.0.1`, `1`); `true` trusts any forwarded address, so use it only when the port is reachable through the proxy alone (the server warns at start) |
| `CORS_ORIGINS` | not set | Other web addresses allowed to call the API. When not set, the dev addresses (`localhost:3000`, `:5173`) are allowed only if `NODE_ENV` is not `production` |
| `HTTPS_CERT_FILE`, `HTTPS_KEY_FILE` | not set | Let the server serve https itself |
| `CSP`, `CSP_IMG_SOURCES` | `on`, not set | Security policy for the web app; add other map tile hosts here |
| `BACKUPS_DIR`, `BACKUP_KEEP` | `backups` beside the database, 20 | Safety copies made before each reset and restore; also how many scheduled backups are kept (counted apart) |
| `BACKUP_EVERY_HOURS` | 0 (off) | Phase 24: a scheduled backup every this many hours (0 to 168, may be a fraction) |
| `RESTORE_MAX_MB` | 200 | Largest backup file accepted |

## Backups and restore (Phase 9)

Administration, **Backup & KML**. A backup with photos is a zip (`GET /api/v1/backup?photos=1`); without photos it is the JSON file as before. A safety copy is saved before every reset and restore. A restore is checked first: if the backup would leave broken links, double-used fibers or other rule errors, nothing is restored and the problems are listed; the administrator may then restore anyway, and that choice is written to the audit log. A restore never removes or changes an audit entry already stored (older entries from the backup are added), and who made each record is kept.

**Scheduled backups (Phase 24).** Off unless `BACKUP_EVERY_HOURS` is set (for example `BACKUP_EVERY_HOURS=6`). Every that many hours the server saves `fibergis-scheduled-<time>.zip` in the backups folder: the same zip as a safety copy and as `GET /api/v1/backup?photos=1` (`backup.json` plus every photo), so it is restored the same way (Administration, **Backup & KML**). If nothing changed since the last scheduled copy, none is made. The newest `BACKUP_KEEP` scheduled copies are kept; they are counted apart from the copies made before a reset or restore, so they never push one of those out. The first copy is made one interval after the server starts. A failed copy (disk full, folder not writable) is written to the server log and tried again at the next interval; nothing else stops. The backups folder is on the same disk as the database: copy it to another place as well.

## Database upgrade (Phase 23 and Phase 24)

Copy the database file (and its `-wal` file) before the first start of a new version. Tables are described in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), routes in [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

- **Phase 23** adds the history and change request tables (schema number 2). Retention of whole-record versions: `REVISION_KEEP_DAYS` (default 365, 1 to 36,500) and `REVISION_KEEP_PER_RECORD` (default 50, 1 to 10,000); older versions are removed at start and then at most once an hour. The audit events are never removed.
- **Phase 24** adds the spatial index and the change log (schema number 3). The first start builds the index from every record (for 100,000 records, a few seconds); nothing in `records` changes. After this, a Phase 23 server refuses to open the file ("schema v3 is newer than this server supports"), because it would write without keeping the change log, and phones would miss changes. To go back, use the copy made before the upgrade or restore a backup.

| Setting | Default | What it does |
|---|---|---|
| `REVISION_KEEP_DAYS` | 365 | Phase 23: whole-record versions older than this are removed |
| `REVISION_KEEP_PER_RECORD` | 50 | Phase 23: most versions kept for one record |
| `BACKUP_EVERY_HOURS` | 0 (off) | Phase 24: scheduled backups, see above |

**Large networks (Phase 24).** Phones and browsers no longer download the whole network every time something changes: after the first load they ask only for the changes since their revision (`GET /changes`), and fall back to the whole network after a restore or reset. The map-area query (`GET /network/area`) and paging (`GET /<collection>?limit=`) are there for screens that need only part of the network. To measure a server computer, run `npm run benchmark -w @fibergis/server` (it builds 100,000 synthetic records in a temporary database, never the real one).

**Big networks in the browser (Phase 24b).** Nothing to set up. When the server holds 30,000 or more equipment, cable, customer, span, duct, slack loop and building records, browsers and phones load only the map areas a person looks at, plus everything else (splitters, closures, settings, the catalogue, ...) in full. The top bar then shows **Part loaded**: tapping it explains that lists, counts, checks and reports use only what is loaded, and offers **Load the whole network on this device** (for an office computer that needs whole-network reports; the choice is kept on that device, and the sync menu offers to go back). On 100,000 records the measured first load was 2 s and 57 MB of browser memory by map area, against 24 to 56 s and over 900 MB for the whole network (see [NETWORK_MAPPING_TEST_PLAN.md](NETWORK_MAPPING_TEST_PLAN.md), Workflow L). The server needs no new setting; the two read routes it adds are in [API_DOCUMENTATION.md](API_DOCUMENTATION.md). An edit of an item's plain details (a pole renamed, a note, a photo) is now checked in milliseconds on a big network; moving an item still takes the whole-network fibre check (seconds on 100,000 records).

## Other settings

Every server setting is read from the environment at start (`apps/server/src/config.ts`). Those not described in a section above:

| Setting | Default | What it does |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `5000` | Where the server listens. Use `0.0.0.0` only behind the reverse proxy or on a trusted network |
| `DATABASE_PATH` | `apps/server/data/fibergis.db` | The first organisation's database. Its photos, voice, backups, `control.db` and `organisations/` sit beside it unless set apart |
| `STATIC_DIR` | `apps/web/dist` | The built web app the server hands out |
| `SEED_SAMPLE_DATA` | `true` | Puts the demo network in an empty database at the first start. Set `false` for a real installation |
| `OSRM_URL`, `ROUTING_TIMEOUT_MS` | public OSRM demo server, 5000 | Road routing for "follow the road" (`POST /routing/route`). The public server is for testing only: run your own for real use |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `SARVAM_API_KEY`, `SARVAM_MODEL`, `SARVAM_DAILY_CHAR_LIMIT`, `SARVAM_TIMEOUT_MS` | none, `bulbul:v4-flash`, 20000, 30000 | Voice lessons in Telugu and Kannada. Without a key no clip is made; the daily limit is a spending guard |
| `VOICE_DIR` | `voice` beside the database | Where generated voice clips are kept |

The browser tests in `e2e/` start their own temporary server with `PORT=5056`, a temporary `DATABASE_PATH` and `SEED_SAMPLE_DATA=false`; see `e2e/README.md`.

## Organisations: several ISPs on one server (Phase 23b)

One server can hold several organisations. Each has its own database file, photos, voice clips and backups; nobody in one can see or change another's. Rules and tables: [SECURITY_AND_PERMISSIONS.md](SECURITY_AND_PERMISSIONS.md#organisations-phase-23b), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#organisations-phase-23b-controldb).

**Upgrade.** Nothing to do. On the first start of this version the server makes `control.db` beside the database and lists the existing database as the first organisation, named by `ORGANISATION_NAME` (default "My organisation"; rename it later on the screen). The database, its `photos`, `voice` and `backups` folders, every account, every login and every push token stay as they are: nothing is copied, moved or renamed, and nobody has to log in again. As before any upgrade, copy the data folder first. A server with only one organisation works exactly as before, including setup mode on the server computer.

**Adding an organisation.** Log in as an administrator (Super Admin) of the first organisation; you are then the platform administrator. Administration, **Users and roles**, "Organisations on this server": type the organisation's name, its administrator's name and login name, and press **Add organisation**. Give that person the temporary password shown once; they choose their own at first login and add their own people. Login names are unique on the whole server, and everyone uses the same login screen. **Switch off** stops every login and push token of that organisation and logs everyone in it out, and keeps all its data; **Switch on** brings it back. The first organisation cannot be switched off.

**Folders.**

| Path (default, beside `DATABASE_PATH`) | What |
|---|---|
| `fibergis.db`, `photos/`, `voice/`, `backups/` | The first organisation, as before |
| `control.db` | The organisations list and which organisation each login name belongs to (`CONTROL_DATABASE_PATH`) |
| `organisations/ORG-…/fibergis.db`, `photos/`, `voice/`, `backups/` | Each added organisation (`ORGANISATIONS_DIR`) |

**Backing up.** Back up the whole data folder (with every `-wal` file, or with the server stopped), `control.db` included: it is what lists the added organisations. For **one organisation**, either its administrator downloads Administration, **Backup & KML** (only their network and photos), or copy its folder `organisations/ORG-…/` (database with accounts, photos, voice, backups) with the server stopped. Scheduled backups (`BACKUP_EVERY_HOURS`) run for every organisation, each into its own `backups/` folder. A restore or reset changes only the organisation of the person doing it, and its safety copy goes into that organisation's folder.

**Monitoring.** Each organisation makes its own sources and push tokens. A token now names its organisation (`fgm_ORG-….<secret>`); put the whole token in the device or script. Tokens of the first organisation look as before and keep working.

| Setting | Default | What it does |
|---|---|---|
| `ORGANISATION_NAME` | My organisation | Name given to the first organisation when it is first listed |
| `CONTROL_DATABASE_PATH` | `control.db` beside the database | The organisations list |
| `ORGANISATIONS_DIR` | `organisations` beside the database | One folder per added organisation |

If `control.db` is lost, the first organisation is listed again by itself on the next start (its data is untouched), and the added organisations are not opened: the server reports their folders. Restore `control.db` from the backup to bring them back.

## Live monitoring (Phase 7)

No OLT is connected yet: until a real source sends data, every screen says "No live connection". The adapters are described in `MONITORING_ADAPTERS.md`.

**Database.** The first start of a Phase 7 server adds one table, `monitoring_tokens` (`CREATE TABLE IF NOT EXISTS`), and leaves the schema number (`user_version`) at 1. Readings, statuses and sources are ordinary records (`onuReadings`, `onuStatuses`, `monitoringSources`), so they are in the JSON backup; tokens are not.

**Set up a push source** (administrator):

1. Menu, **Live status**, **Sources**. Type a name (such as "NMS push, OLT-1"), choose "Push from a script or NMS", **Add source**.
2. The token (`fgm_…`) is shown **once**. Copy it into the script's secret store straight away; the server keeps only a hash and cannot show it again. **New token** replaces it (the old one stops working); **Revoke token** stops it.
3. Run the script on your own network, sending `POST https://<server>/api/v1/monitoring/ingest` with `Authorization: Bearer <token>` and the rows described in `MONITORING_ADAPTERS.md`. Use https once the server is reachable beyond one trusted network.
4. **Switch off** stops a source at once without losing its history.

The token can only send rows: it cannot read the network or open any other route. Never put it in the code, git, a chat or a log; if it leaks, make a new one.

**File import:** add a "File import" source the same way, then **Import file** (administrator or engineer). **TEST simulator:** add a "TEST simulator" source; it stays off until the administrator switches it on, and all its rows and alarms are marked TEST.

| Setting | Default | What it does |
|---|---|---|
| `INGEST_PER_MINUTE` | 60 | Push requests per minute per source (per address for unknown tokens). A request carries at most 2000 rows and 512 KB |
| `MONITORING_KEEP_DAYS` | 90 | Device readings and statuses older than this are removed at the next import or push. The newest one for each ONT is always kept |
| `MONITORING_MAX_ROWS` | 200000 | Most readings (and most statuses) kept; beyond this the oldest go first |

Administration, **Monitoring settings**: when a status (15 min, at most 1 day) and a reading (60 min, at most 7 days) become stale, and how far ahead of the server clock a device time may be (5 min, at most 1 day). All proposed: set them to a little more than twice your OLT's or NMS's sending interval.
