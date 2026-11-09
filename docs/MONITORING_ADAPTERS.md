# Monitoring adapters

How FiberGIS gets ONU status and optical readings, and how to add a direct adapter once the OLT make and model are known (decision 7).

**State (November 2026): no real OLT has been connected.** No vendor SNMP, CLI, TR-069 or vendor API adapter exists. What exists is the framework below, with three ways in: a file export, a push endpoint for a script or NMS on your own network, and a TEST simulator. Until a real source sends data, every screen says "No live connection".

## The rule every adapter keeps

Nothing is called Live, Online or Measured unless it came from a real source with a real device time.

- Every row is stored with origin `device_reported`, the source id, the device's own time (with its time zone) and the time this server received it.
- A row is matched to an ONT only when its ONU address or serial is exactly what is written on one live ONT record. Spaces at the ends are ignored; nothing else is changed. Case, leading zeros and vendor formats are not converted. A row that matches nothing, or matches two ONTs, is kept with the reason and listed under Live status, Not matched. It is never shown on a customer.
- A row with no time zone, a time in the future (more than `monitoring.maxFutureMinutes`), a unit other than dBm, or a level outside -60 to +15 dBm is skipped with the reason.
- The same row sent twice is stored once (its id is worked out from its content).
- TEST rows come only from the TEST simulator and are marked TEST everywhere.

All of this is one function, `planIngest` in `packages/shared/src/domain/monitoringIngest.ts`. The browser preview and the server use the same code. A new adapter only has to produce rows; it must never write readings any other way.

## What exists now

| Way in | Who | How |
|---|---|---|
| File import | Administrator and engineers | Live status, Import file. Choose a CSV or TSV your OLT or NMS exported, choose which column is which (saved on the source for the next file), map the vendor's status words, Preview (stores nothing), then Import |
| Push endpoint | A script or NMS on your network, with a token | `POST /api/v1/monitoring/ingest`, see below |
| TEST simulator | Administrator | Live status, TEST simulator. Off until a TEST source is added and switched on. Type a status and a level for one ONT |

Sources and tokens are made only by the administrator (Live status, Sources). A push token is shown once; the server keeps only its SHA-256 hash in the `monitoring_tokens` table. The token can only ingest: it opens no other route.

### Push format

```
POST /api/v1/monitoring/ingest
Authorization: Bearer fgm_…
Content-Type: application/json

{ "rows": [
  { "onuAddress": "gpon-onu_1/2/3:5", "deviceTime": "2026-11-09T10:15:00+05:30",
    "state": "online", "rawState": "working", "ontRxDbm": -21.4, "oltRxDbm": -24.8, "unit": "dBm" },
  { "serial": "ZTEGC0FFEE01", "deviceTime": "2026-11-09T10:15:00+05:30", "state": "los" }
] }
```

- `onuAddress` or `serial` (or both). As your OLT writes them.
- `deviceTime`: ISO 8601 with a time zone.
- `state`: one of `online`, `offline`, `los`, `dying_gasp`, `unknown`. Your script maps the vendor's words to these; put the vendor's own word in `rawState`.
- `ontRxDbm` (ONT receive) and `oltRxDbm` (the OLT's receive from this ONU, upstream): numbers or strings, with `unit: "dBm"`.
- At most 2000 rows and 512 KB per request; `INGEST_PER_MINUTE` requests per minute per token (default 60).
- The answer lists how many matched, which rows were not matched and why, which were skipped and why, how many were already stored, and how many alarms were raised.

### What happens to a row

1. Stored in `onuStatuses` or `onuReadings` (history; nothing is overwritten).
2. The customer panel, the ONT and the Live status dashboard show the newest real row with its age and source. Older than `monitoring.statusStaleMinutes` (status) or `monitoring.readingStaleMinutes` (reading) it is shown as stale.
3. A new LOS or offline status, or an ONT receive level outside the Optical settings bands, raises a Phase 8 alarm with source `device_adapter` on the ONT's customers (or the ONT). Correlation words any shared cause "suspected". An open alarm is counted again, never duplicated. Old rows (a history import) and dying gasp raise nothing. TEST rows raise TEST alarms only.
4. The newest real ONT receive reading is used as the measured value in "Reading against the records" (predicted against measured).

## Adding a direct adapter for your OLT

Needed from the owner first (decision 7):

1. **Make, model and software version of each OLT** (for example Huawei MA5800 R021, ZTE C320 V2.1, a BDCOM EPON model). Each vendor exposes status and optical power differently, and the same vendor changes names between versions.
2. **Which interface you allow**: SNMP v2c or v3 (read only), the vendor's CLI over SSH, the vendor's NMS northbound API, TR-069/CWMP from an ACS, or a syslog/alarm feed.
3. **Read-only access to one test OLT** (or a real export from it) to check the exact field names, units and status codes. The addressing styles in `fibergis-ftth-mapping` (Huawei `0/5/0 ont 1`, ZTE `gpon-onu_1/x/y:n`, Nokia `1/1/1/2/33`, BDCOM `ePON 0/1:5`) come from third-party guides and must be checked against a real device.
4. **How often to poll**, and the network path from the FiberGIS server to the OLT management address.
5. **Where credentials live**: never in the code, the database records or git. Use environment variables or a secret file outside the repository, readable only by the server account.

Then:

1. Write the adapter as a small separate program or module whose only output is rows in the push format above. The interface is:

   ```ts
   interface MonitoringAdapter {
     sourceId: string;            // a push source made by the administrator
     kind: 'pull' | 'push';
     pull(): Promise<IngestRow[]>; // for pull adapters: read the OLT, return rows
   }
   ```

   A pull adapter runs on a schedule and sends what `pull()` returns to `/api/v1/monitoring/ingest` with its token. Keep it outside the web server process, so a slow or hung OLT never slows the map.
2. Normalise in the adapter, not in FiberGIS: convert the vendor's optical value to dBm only when the vendor documents the formula (some SNMP tables give hundredths or thousandths of a dBm, some give µW). The server keeps the level as sent in `rawValue`; send the vendor's own status word in `rawState`. Map the vendor's status codes to the five states and send anything unclear as `unknown` with the raw word.
3. Send the device's own time for the value. If the OLT gives no time, send the poll time and say so in the source description; never invent an older or newer time.
4. Use timeouts, a few retries with back-off, and stop on authentication errors. Log counts, never credentials, tokens or customer details.
5. Add tests with a real export from the owner's OLT (anonymised) before calling it working.
6. Update this file, `docs/IMPLEMENTATION_PLAN.md` (Phase 7) and the "known gaps" in `fibergis-data-truth` and `fibergis-ftth-mapping`.

## Not built

- No vendor SNMP, CLI, TR-069 or NMS API adapter (needs decision 7).
- No live push to the browser (WebSockets or SSE): the app checks the server every 30 seconds.
- No trend charts; history is a list.
- No OLT-level status (OLT reachable or not) or PON port optical levels; only per-ONU rows.
- No separate receive bands for the OLT upstream level: it is shown with "No band set".
- History is kept in the network records, so a very large or very frequent feed will make the browser's offline copy large. Trim or archive old rows before connecting a high-volume source.
