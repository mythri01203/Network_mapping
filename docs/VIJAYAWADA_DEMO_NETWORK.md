# Vijayawada demo network (DASAN V5808, 500 customers)

**This is sample data.** The names, phone numbers, ONT serials, ONU ids, management IP and positions are all made up. Positions are rough, not surveyed. Every OLT, box, pole and customer record carries `isSampleData`, and the app shows them as "Sample data". Every power level here is **calculated** from the Optical settings. None of it is measured.

Builder: `packages/shared/src/sample/vijayawadaNetwork.ts`. Test: `packages/shared/test/vijayawadaDemo.test.ts`.

## What is in it

| Part | Count | Detail |
|---|---|---|
| CO site and rack | 1 + 1 | Vijayawada CO (Labbipet), Rack 1, 42U |
| OLT | 1 | DASAN V5808, 8 GPON ports, B+ optics recorded per port, launch +2.7 to +4.1 dBm |
| ODF | 1 | 96 ports: Panel A (north feeder) and Panel B (south feeder), SC/APC, patch cords PC-01 to PC-08 |
| Feeder cables | 2 | 48F (4 × 12, TIA-598), aerial, ODF → joint closures JC-N01 and JC-S01 |
| Joint closures | 2 | Dome closures. Fusion splices are colour to colour (feeder fiber N → branch fiber N), loss marked "designed" |
| Branch cables | 8 | 12F, closure → FDT, one per PON port |
| FDT + primary splitter | 8 | One 1:8 PLC per PON port |
| Distribution cables | 64 | 6F, FDT → FAT. Fiber 1 is fed from one primary splitter output |
| FAT + secondary splitter | 64 | One 1:8 PLC each, so 1:64 per PON |
| Drops, ONTs, customers | 500 each | Two-fiber drop (TIA-598: fiber 1 blue in service, fiber 2 orange spare), one ONT record (DASAN H660GM, ONU id `<PON>/<ONU>`), one customer |
| Services | 600 | 500 internet (50 to 300 Mbps), 100 IPTV. Every 37th customer is suspended |
| Poles, spans, attachments | 519 + 445 + 964 | Electricity poles about every 50 m on feeder, branch and distribution routes. Each cable is attached to its poles and spans |
| Slack loops | 2 | 20 m at each joint closure |

There are 63 customers on PON-01 to PON-04 and 62 on PON-05 to PON-08. Each PON keeps one or two splitter outputs free for repairs.

Every customer traces fiber by fiber with no gap: OLT port → patch cord → ODF port → feeder fiber → splice → branch fiber → primary 1:8 → distribution fiber → secondary 1:8 → drop fiber → ONT. The test checks all 500 traces, and the fiber, connection and link rules report no errors.

## Splitter configuration and power levels (calculated)

Downstream is 1490 nm, starting from each port's recorded launch power. Each splitter output level includes its output adapter. OLT Rx assumes the ONT launches +2 dBm (B+ ONUs launch +0.5 to +5 dBm).

| PON | DASAN port | Area | OLT Tx (dBm) | Primary 1:8 in → out (dBm) | Secondary 1:8 in → out (dBm) | ONT Rx (dBm) | OLT Rx from ONT (dBm) | Path loss down (dB) | Distance (km) | Customers |
|---|---|---|---|---|---|---|---|---|---|---|
| PON-01 | `gpon-olt 1` | Suryaraopet | +2.9 | +1.8 → -8.6 | -8.6 to -8.7 → -19.3 to -19.4 | -19.7 | -20.7 to -20.8 | 22.6 | 2.01–2.21 | 63 |
| PON-02 | `gpon-olt 2` | Governorpet | +3.2 | +1.8 → -8.6 | -8.6 to -8.7 → -19.3 to -19.4 | -19.6 to -19.7 | -21.1 to -21.2 | 22.8–22.9 | 3.03–3.21 | 63 |
| PON-03 | `gpon-olt 3` | Gunadala | +3.5 | +2.2 → -8.2 | -8.3 → -19.0 | -19.3 | -21.1 | 22.8 | 2.93–3.16 | 63 |
| PON-04 | `gpon-olt 4` | Moghalrajpuram | +3.8 | +2.7 → -7.7 | -7.8 → -18.5 | -18.7 to -18.8 | -20.7 to -20.8 | 22.6 | 1.96–2.16 | 63 |
| PON-05 | `gpon-olt 5` | Labbipet | +4.1 | +3.1 → -7.3 | -7.4 → -18.1 | -18.4 | -20.6 to -20.7 | 22.5 | 1.75–1.97 | 62 |
| PON-06 | `gpon-olt 6` | Benz Circle | +2.7 | +1.6 → -8.8 | -8.8 → -19.5 | -19.8 to -19.9 | -20.7 to -20.8 | 22.5–22.6 | 1.94–2.13 | 62 |
| PON-07 | `gpon-olt 7` | Patamata | +3.0 | +1.6 → -8.8 | -8.9 → -19.6 | -19.9 | -21.2 to -21.3 | 22.9 | 3.22–3.39 | 62 |
| PON-08 | `gpon-olt 8` | Gurunanak Colony | +3.3 | +2.0 → -8.4 | -8.4 to -8.5 → -19.1 to -19.2 | -19.4 to -19.5 | -21.0 to -21.1 | 22.7–22.8 | 2.78–2.99 | 62 |

How one path adds up (downstream, defaults from Administration, Optical settings):

| Item | Loss (dB) |
|---|---|
| Two 1:8 PLC splitters, 10.4 dB each | 20.8 |
| Fiber, about 2 to 3.4 km at 0.25 dB/km | 0.5–0.85 |
| One fusion splice (designed) | 0.03–0.07 |
| Four connector pairs (PON, ODF, FAT output adapter, ONT) at 0.3 dB | 1.2 |
| **Total** | **about 22.5 to 22.9** |

The B+ class allows 13 to 28 dB, so every path shows "fits with margin", leaving about 5 dB spare. ONT Rx of -18.4 to -19.9 dBm is well inside the good band: above -27 dBm (sensitivity) and below -8 dBm (overload). The splitter losses are proposed defaults, not datasheet values. Before signing off a real build, enter the installed splitters' datasheet loss and compare with a power meter reading.

## On the map

The map reads the PON of every cable, box and customer from the recorded fibers (`buildPonOverview`, `packages/shared/src/domain/ponOverview.ts`):

- **Network by PON panel** (top right). It shows active and inactive customers, free outputs (new connections possible) and suspected-affected customers. Each PON row has its area, streets, used outputs and free outputs. Click a PON to light it up and fly to it. Its detail lists every splitter with its stage, ratio, used outputs and estimated output level.
- **Cables** are coloured by PON in the TIA-598 order (PON 1 blue, 2 orange, 3 green, …). A feeder carrying several PONs is a dark trunk. From zoom 14, moving light runs along fibers that reach an active customer; switch it off with **Light flow**. From zoom 16 each cable shows its PON and the fibers used.
- **Boxes** (FDT, FAT) carry a badge: a compact one at zoom 16 to 17, and from zoom 18 a full one with the PON, splitter ratio and stage, free outputs, a dot per output, and the estimated level in and out. The OLT badge shows make, PON colours, customers and free outputs.
- **Customers** have a ring in their PON colour. Inactive customers are grey. A customer named by an open fault, or reached by an open alarm, pulses red (TEST alarms pulse violet).
- **Poles and spans** appear from zoom 17 (change it in Layers).
- **Box details**: the *Splitter design and light* section shows the input fiber and its colour, the loss, each output with its customer, the drop fiber colour and the estimated ONT level. The cable and customer details panels have a *PON* section too.

## Add or remove the demo

Run these on the server computer, in `apps/server`:

```
npm run user -- add-vijayawada-demo [organisation name]
npm run user -- remove-vijayawada-demo [organisation name]
```

Add refuses to run if the demo is already there. Remove deletes only demo records: the `VJA-` ids, plus the drops, ONTs, services, closures, spans, attachments, slack loops, site and rack that point at them. Both commands go through the same server checks as a normal save and write an audit line. After either command, reload the app.

## DASAN poller (real OLT integration)

`apps/server/src/monitoring/dasan/poller.ts` reads the OLT by SNMP and sends what it reads to FiberGIS through the push endpoint (`docs/MONITORING_ADAPTERS.md`). It uses DASAN's published SLE-GPON-MIB (`1.3.6.1.4.1.6296.101.23`):

| Value | OID column |
|---|---|
| ONU status | `.3.1.1.2` |
| Serial | `.3.1.1.4` |
| ONT Rx, 0.1 dBm | `.3.1.1.16` |
| OLT Rx from ONU, 0.1 dBm | `.3.1.1.21` |
| Reason the ONU went down (dying gasp, LOS) | `.3.1.1.45` |
| PON port status and ONU counts (optional) | `.2.1.1.2`, `.21`, `.22` |

Steps:

1. Write the OLT's real management IP on the OLT record (the demo has the sample value `10.20.0.11`).
2. Live status, Sources: add a **Push** source, for example "DASAN V5808 poller", and copy its token. It is shown only once.
3. On a computer that can reach the OLT, set `DASAN_HOST`, `DASAN_COMMUNITY` and `FIBERGIS_TOKEN`, then run `npm run poll:dasan -w @fibergis/server -- --check`. This prints what it read and sends nothing.
4. Compare the printout with `show onu info` on the OLT: the ONU address (`<OLT>/<ONU>`), the serial and the Rx. If the levels come out wrong (for example around +6500), set `DASAN_RX_ENCODING=signed`.
5. Run with `--once` to send one poll. Then run with no flag to poll every `POLL_SECONDS` (default 300). Add `DASAN_PON_STATUS=on` to also send PON port status.

Rows are matched to ONTs only on the exact ONU address or serial. A row that does not match shows under Live status, Not matched, and never appears on a customer. Until a real OLT sends data, screens say "No live connection".

Not yet checked on a real V5808:

- whether negative levels come back signed or as 16-bit values
- whether the SNMP index numbers equal the CLI `gpon-olt N` and ONU numbers
- the PON port table column numbers
- the ONUs-per-port limit and the SFP optics class (no public source found)

The `--check` run in step 3 settles the first two.
