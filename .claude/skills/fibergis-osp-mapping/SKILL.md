---
name: fibergis-osp-mapping
description: Rules for mapping outside plant in FiberGIS, including telecom and electric poles, aerial spans, ducts, manholes, slack loops, buildings, phone GPS accuracy, cable length, asset IDs and QR tags, KML or GeoJSON import and export, right-of-way permissions, DISCOM or BESCOM poles, and field safety. Use whenever work touches where something is on the map, how far apart things are, who owns or permits a structure, or whether a mapped position or length can be trusted.
---

# Outside plant mapping

Most rules here are reasoned proposals, not standards. Keep every limit editable. India rules, safety wording and sources are in `references/india-rules.md`; read it before writing anything about permissions, fees or safety.

## Model

Poles and chambers are points. Spans and ducts link them. Cables run through an ordered list of spans or ducts. Slack loops are point assets on a host. A cable crossing a pole on the map does not mean it is attached.

Today poles, manholes and ducts are plain equipment points, and duct is not even a line. Attachments, spans, sub-ducts, risers, crossings and permissions do not exist (`docs/AUDIT_REPORT.md` section 4).

## Position

**Plan on about 5 m at best.** Phones reach about 4.9 m under open sky and worse near buildings and trees. W3C now defines browser `accuracy` as a 68% radius (MDN still says 95%; follow W3C), so "5 m" means about 8 m at 95%. Street-canyon reflections can break even that. HTTPS is required, and `enableHighAccuracy` is only a hint.

**Proposed limits:**

| Asset | Accept | Warn | Above that |
|---|---|---|---|
| Pole, closure, manhole | ≤5 m | 5–10 m | Map-placed correction with a reason |
| Route point | ≤15 m | | Poles anchor the route |

Store method (GPS, GPS-averaged, map-placed, imported), reported accuracy, sample count and time per point. Never store accuracy 0 on a map-placed point, because it looks perfect. Averaging is cheap but mainly removes jitter.

**Retry before correcting.** Above 10 m, first ask the worker to go to open sky and wait. If that fails, the office places the point using a photo, with a reason recorded; workers should not have to.

**Do not automatically shift positions to match imagery.** Google Earth in India measured 3.75–6.83 m RMSE in one study, with no systematic error, so a fixed correction has no support. One-off correction of a single point, with a reason, is different.

**Capture is "I am at this pole".** Dragging should be a reviewed correction. Today pins always drag, and moving one leaves its cables behind (`EquipmentLayer.tsx`).

## Length

**Keep drawn, sheath, optical and slack lengths separate.** Today the app has one `lengthMeters`, calculated from drawn points, and no length input in the cable form or accuracy field on equipment. So until Phase 3, keep measured lengths in the cable's remarks and say so plainly.

- `sheath ≈ drawn + slack + vertical + tails`
- `optical ≈ sheath × (1 + excess)`, excess 1–3%, up to about 4%

**Sag is not the reason maps run short.** At the 2% limit it adds about 0.11%, roughly 1 m per km. The real gap is slack, vertical runs, corners and tails.

**Do not use GPS tracks for length.** Tracks over-report: four devices on one hike differed by about 13%. Use tracks to place points only. Calculate length geodesically, because Web Mercator inflates by 1/cos(latitude): about 1.01 at 8°N, 1.15 at 30°N, 1.22 at 35°N.

**Proposed flags:**

| Finding | Suggests |
|---|---|
| Optical shorter than sheath by over 1% | Wrong core, wrong cable or an unrecorded break |
| Optical longer by over 5% | Unrecorded slack or a detour |
| Map and installed length differ by over 10% | Needs review |
| Long aerial route with no slack entries | Slack was not captured |

**Cable marks are the best physical measure,** typically ±0.5% from the factory. Photograph them at both ends and either side of each loop, and note the unit, since some cable is marked in feet. Marks can count down or jump after a repair, so use the absolute difference.

**Slack has no universal rule.** Found: 10 m at aerial splices (Indian instructions), 20 m at chambers and 3–5 m per joint (Handbook), 40 m in one Army spec. No source confirmed any "X m per km" rule, including 15 m/km. Offer defaults, label them as defaults, and record what was actually left. Each uncounted loop shifts a fault location by its full length.

## Records

Keep the required field record short, because over-collection costs time and causes errors. The office fills in the rest.

| Asset | Required in the field | Add later |
|---|---|---|
| Pole | ID, location with accuracy, owner, material, photo | Power on pole, condition, attachments, permission |
| Aerial span | From and to pole, cable ID, mapped length | Measured length, road crossing, clearance |
| Cable | ID, core count, owner | Type, marks, install date, color scheme |
| Slack loop | Host, length, cable ID | Mark difference as proof |
| Duct | Route, count and diameter | Depth seen, occupancy, method, permit depth |
| Manhole or handhole | ID, location, type | Cover and inside photos, ducts, slack, water |
| Closure | ID, location and host, type and capacity | Cables, splices, test results |
| FAT or splitter | ID, parent, ratio, photo | Ports used and free |
| Building | Name or address, location | Entry, riser, permission, drop source |
| Permission | Authority, type, reference, dates and expiry | Route covered, fee, scan |

## IDs and duplicates

- Use two values: an unchanging short code on a QR tag, plus a display name like `KRM-FAT-0142`
- Do not encode the parent in the ID, because parents change on re-splice
- A DISCOM's number goes in `owner_pole_no`, never the key. It may be absent, repeated or repainted
- Before creating a point, list same-type assets within about 1.5 × GPS radius plus a margin, and ask "same as this one?" with its photo
- A QR scan opens the existing record
- Spans link existing poles rather than free lines
- Merges keep the older ID, with a pointer

## Import and export

- GeoJSON and KML are longitude first, WGS 84. Six decimals is about 10 cm
- India's latitude (6–38°N) and longitude (68–98°E) do not overlap, so an importer can detect swaps
- Accept KMZ and folders. Keep `name` and `description` as written
- Ask rather than assume a Placemark is a pole or a line is one cable
- Never trust KML length. Drop altitude, which is usually zero

KML import is missing today, and Indian ISPs commonly hold KML, so this is high value.
