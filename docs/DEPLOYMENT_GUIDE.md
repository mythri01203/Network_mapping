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

Then build and start the app (`npm run build`, then `npm start`) and open `https://fibergis.example.in/capture` on the phone. **Do not expose the server to the internet before login exists** (see the security section of `AUDIT_REPORT.md`); keep the domain reachable only on your own network or VPN.

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

## Settings for the field

Administration, **Field capture settings**: GPS accept and warn limits, readings to average, how long to wait before offering "office will place it", the "same one?" search radius, light meter decimals and plausible range, and the supervisor's phone number (the **Call supervisor** button stays hidden until it is set). All limits are proposals from `fibergis-osp-mapping`; test them on your own streets.
