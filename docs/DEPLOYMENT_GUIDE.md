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
- **Backup:** the JSON backup in Administration does **not** include photos. Back up the `photos` folder with the database file.
- Records point at photos by id; a stored photo is never replaced.
- Job photos from **My jobs** (`/jobs`, Phase 8) use the same queue and folder.

## Database upgrade (Phase 8)

The first start of a Phase 8 server adds a `version` column to the records table. It changes no record and no revision, and it leaves the schema number (`user_version`) at 1, so an older server can still open the database; writes made by an older server do not change a record's version, so a version check cannot see them. Copy the database file (and its `-wal` file, if present) before the first start anyway. Clients that do not send versions keep working as before.

## Settings for the field

Administration, **Field capture settings**: GPS accept and warn limits, readings to average, how long to wait before offering "office will place it", the "same one?" search radius, light meter decimals and plausible range, and the supervisor's phone number (the **Call supervisor** button stays hidden until it is set). All limits are proposals from `fibergis-osp-mapping`; test them on your own streets.

## Login (Phase 9)

**Setup mode.** A server with no user accounts runs with login off, as before, and every screen shows "Login is off — create the first admin account; keep this server on a trusted network". This is so an existing server is not locked out when it is upgraded. In setup mode anyone who can reach the server can change or reset data, and can create the first administrator, so do this straight away:

1. Open the app, go to Administration, **Users and roles**, and create the first administrator account. Login is on from that moment.
2. Add an account for each person with the right role: **admin** (everything, including users, reset and restore), **engineer** (network design), **office** (customers, faults, work orders), **technician** (their own jobs and field capture; cannot delete network records), **viewer** (look only; phone numbers hidden).
3. New accounts get a temporary password, shown once. The person must set their own at first login.

To be safe before anyone else can reach the server, set `SETUP_TOKEN` (the first administrator then also needs that code) or `AUTH_REQUIRED=true` (no setup mode at all).

**Nobody can log in?** On the server's own computer: `npm run user -w @fibergis/server -- list`, and `npm run user -w @fibergis/server -- reset-password <login name>`, which prints a temporary password once.

**Unsent work is kept.** If a phone's session ends while it holds unsent changes, the app asks the person to log in again and then sends them.

| Setting | Default | What it does |
|---|---|---|
| `AUTH_REQUIRED` | `false` | `true`: login is required even before the first account exists |
| `SETUP_TOKEN` | not set | Code needed to create the first administrator |
| `SESSION_DAYS` | 30 | How long a login lasts |
| `PASSWORD_MIN_LENGTH` | 8 | Shortest allowed password |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES` | 5, 15 | Wrong passwords allowed before waiting, and how long |
| `RATE_LIMIT_PER_MINUTE` | 1200 | Requests per minute per address |
| `COOKIE_SECURE` | `auto` | Secure cookies when the request came over https |
| `TRUST_PROXY` | not set | Trust a reverse proxy's forwarded address and protocol |
| `CORS_ORIGINS` | not set | Other web addresses allowed to call the API |
| `HTTPS_CERT_FILE`, `HTTPS_KEY_FILE` | not set | Let the server serve https itself |
| `CSP`, `CSP_IMG_SOURCES` | `on`, not set | Security policy for the web app; add other map tile hosts here |
| `BACKUPS_DIR`, `BACKUP_KEEP` | `backups` beside the database, 20 | Safety copies made before each reset and restore |
| `RESTORE_MAX_MB` | 200 | Largest backup file accepted |

## Backups and restore (Phase 9)

Administration, **Backup & KML**. A backup with photos is a zip (`GET /api/v1/backup?photos=1`); without photos it is the JSON file as before. A safety copy is saved before every reset and restore. A restore is checked first: if the backup would leave broken links, double-used fibers or other rule errors, nothing is restored and the problems are listed; the administrator may then restore anyway, and that choice is written to the audit log.
