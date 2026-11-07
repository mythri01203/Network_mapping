# Optical reference values

Evidence grades: **Standard** (standard's text read), **Vendor/Operator** (a datasheet or operator document), **Excerpt** (seen only in a search extract), **Proposed** (judgement from this research; no source states it as a rule). A datasheet for the installed part overrides all of these. Sources: `reports/ISP and cable TV mapping rules.md`.

## Power budgets

| Class | OLT launch dBm | OLT Rx sens. / overload | ONU launch | ONU Rx sens. / overload | Path loss dB | Grade |
|---|---|---|---|---|---|---|
| GPON B+ | +1.5 to +5 | −28 / −8 | +0.5 to +5 | −27 / −8 | 13–28 | Standard (G.984.2) |
| GPON C+ | +3 to +7 | −32 / −12 | +0.5 to +5 | −30 / −8 | 17–32 | Standard (assumes FEC; OLT also assumes SOA-type detector) |
| EPON PX20 | +2 to +7 | −27 | −1 to +4 | −24 | 24, 1:32 | Vendor; garbled table, column order inferred |
| EPON PX20+ | +2.5 to +7 | −30 | 0 to +4 | −27 | 28, 1:64 | Vendor; same caveat |

Other G.984.2 limits (Standard): 20 km fiber, 20 km differential reach, 60 km logical reach, 15 dB differential path loss. Main-body classes A 5–20, B 10–25, C 15–30 dB.

XG-PON (Excerpt, G.987.2): N1 14–29, N2 16–31, E1 18–33, E2 20–35 dB. XGS-PON uses 1577 nm down and 1270 nm up (Vendor). EPON values conflict between sources, and IEEE Clause 60 was not read, so keep them editable.

## Wavelengths

G/GE-PON 1490 nm down, 1310 nm up. 10G PON 1577 down, 1270 up. Video overlay 1550.

## Default losses

| Item | Proposed default | Evidence range |
|---|---|---|
| Fiber 1310 nm | 0.35 dB/km | 0.34 cabled max (Operator, Bharti spec); 0.4 planning (FOA) |
| Fiber 1490 nm | 0.25 dB/km (conservative 0.30) | 0.30 planning (Vendor) |
| Fiber 1550 nm | 0.25 dB/km | 0.20 cabled max (Operator); 0.25 (FOA) |
| Fusion splice | 0.1 dB, reject 0.2 | Handbook and FOA |
| Mechanical splice | 0.5 dB | Handbook |
| Connector pair | 0.3 dB, reject 0.5 | FOA; a 0.1 dB cord measured 0.2–0.3 in the field |
| PLC 1:2 / 1:4 / 1:8 | 3.8 / 7.1 / 10.4 dB | Ideal 3.0 / 6.0 / 9.0; FOA 4 / 7 / 11; datasheet maxima are excerpts |
| PLC 1:16 / 1:32 / 1:64 | 13.5 / 17.0 / 20.5 dB | Ideal 12.0 / 15.1 / 18.1; FOA 15 / 19 for 1:16, 1:32 |
| FBT 10/90 | about 11.3 / 0.6 dB per port | Excerpt |
| FBT 1/99 | about 23.5 / 0.3 dB per port | Excerpt |

The splitter choice alone can change pass or fail: 1:32 ranges from 16.5 to 19 dB across sources.

For a pass or fail verdict at 1490 nm, also try the conservative 0.30, because 0.25 has no direct source here.

## Worked checks (B+)

Test cases for any calculator, using the defaults above. "Connector pairs" means mated pairs, each 0.3 dB.

| Path | Direction | Sum | Loss | Against 28 dB | After 3 dB margin |
|---|---|---|---|---|---|
| 5 km, 1:32, 6 splices, 4 pairs | 1310 up | 1.75 + 17 + 0.6 + 1.2 | **20.55** | 7.45 left | 4.45 left |
| 5 km, 1:64, 6 splices, 4 pairs | 1310 up | 1.75 + 20.5 + 0.6 + 1.2 | **24.05** | 3.95 left | 0.95 left |
| 20 km, 1:64, 6 splices, 4 pairs | 1310 up | 7 + 20.5 + 0.6 + 1.2 | **29.3** | Over by 1.3 | Fails |
| 12 km, 1:4 + 1:16, 8 splices, 4 pairs | 1490 down | 3 + 20.6 + 0.8 + 1.2 | **25.6** | 2.4 left | Short by 0.6 |
| 12 km, 1:4 + 1:16, 8 splices, 4 pairs | 1310 up | 4.2 + 20.6 + 0.8 + 1.2 | **26.8** | 1.2 left | Short by 1.8 |

Expected ONT Rx on the 12 km path: launch +1.5 to +5 minus 25.6 gives **−24.1 to −20.6 dBm**.

The 3 dB margin is one vendor's recommendation (3–5 dB), not a standard.

## Split limit

No single value. G.984.2 describes 16, 32 or 64-way; the Handbook lists 1:128 for B+; FOA's examples cap at 32. Suggested starting setting (Proposed): warn above 1:64 total, and let each operator lower it. Keep this apart from the vendor's `max_onu`.

## ONT receive bands (Proposed, B+)

No standard defines good or warning. Make these settings per class. The OLT's own configured thresholds have the final word. Each boundary belongs to the better band. C+ needs its own set; its ONU limits are −30 and −8.

| Rx dBm | Meaning |
|---|---|
| Above −8 | Too much light. Check for a missing splitter or wrong path |
| −8 to −24 | Good |
| Below −24 to −27 | Works, little repair margin |
| Below −27, or LOS | Bad |

New installs: stricter −22 downstream Rx acceptance (one Indian operator's benchmark; an operator figure, not proposed here).

Bands and the path check are separate tests. A −9 dBm reading is "good" for the band, yet can still imply too little loss for the class, so flag both.

## Color codes

TIA-598: 1 blue, 2 orange, 3 green, 4 brown, 5 slate, 6 white, 7 red, 8 black, 9 yellow, 10 violet, 11 rose, 12 aqua. One Indian operator spec read uses it, printing "pink" for rose.

Not universal. IEC 60304/DIN opens red, green, blue; IEC 60794-2 opens blue, yellow, red. An Indian OPGW spec accepts TIA-598, IEC 60304 or GR-20 (Excerpt). TEC or BSNL table: **not found**. In 24-fiber tubes, colors can repeat with a binder thread, or use 24 marked colors, so include a binder or group field. Tube marking above 24 conflicts between sources (FOA orange stripe, Prysmian red).

Example, assuming tubes follow the same TIA-598 sequence: under 12F tubes, core 49 is tube 5 (slate), fiber 1 (blue). Builds vary: 96F is 8×12F at STL; FOA shows 24F as 4×6F.

So the same core number means different things. Core 13 of a 24F, assuming TIA-598 throughout:

| Build | Core 13 is |
|---|---|
| 2×12F | Tube 2 (orange), fiber 1 (blue) |
| 4×6F | Tube 3 (green), fiber 1 (blue) |
| 3×8F | Tube 2 (orange), fiber 5 (slate) |
| 1×24F | Position 13; color depends on the vendor's scheme and binder |

Whether tube colors follow the fiber sequence is itself per vendor, so check the drum sheet.

## Cascades and capacity

FOA examples: 2+16, 4+8, 2+4+4, capped at 32 (make the limit a setting). One Indian playbook (Excitel, 2019, not a norm): S1 PLC 1:8 in a closure, then S2 1:8 in a box, customers within about 100 m, which spends 21 dB on splitters. FOA rule of thumb: leave about 8 of 32 ports open when splitters are near users.

## Measuring

- OTDR reads fiber length, about 1–3% longer than sheath, up to about 1.04× in stranded cable
- Test from the subscriber toward the CO; from the OLT, backscatter from all branches adds together
- In-service testing uses filtered 1625 or 1650 nm
- OTDR distance does not prove identity; VFL or light levels confirm which fiber
- Indian as-built template: BBNL requires PON OTDR readings at OLT, splitter, joint and ONT with coil length each side
