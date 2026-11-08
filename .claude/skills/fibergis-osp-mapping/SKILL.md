---
name: fibergis-osp-mapping
description: Rules for mapping outside plant in FiberGIS, including telecom and electric poles, aerial spans, ducts, manholes, slack loops, buildings, phone GPS accuracy, cable length, asset IDs and QR tags, KML or GeoJSON import and export, right-of-way permissions, DISCOM or BESCOM poles, and field safety. Use whenever work touches where something is on the map, how far apart things are, who owns or permits a structure, or whether a mapped position or length can be trusted.
---

# Outside plant mapping

Most rules here are reasoned proposals, not standards. Keep every limit editable. India rules, safety wording and sources are in `references/india-rules.md`; read it before writing anything about permissions, fees or safety.

## Model

Poles and chambers are points. Spans and ducts link them. Cables run through an ordered list of spans or ducts. Slack loops are point assets on a host. A cable crossing a pole on the map does not mean it is attached.

Since Phase 3 this model exists (see "Where the codebase stands" below): spans, attachments, ducts with sub-ducts, slack loops and permissions are their own collections. Since Phase 5 buildings are records too (`buildings`): entry point pin, riser cable, floor boxes and units, footprint as a point. Crossings with clearances and manhole internals still do not exist.

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

**Capture is "I am at this pole".** Dragging should be a reviewed correction. Since Phase 1 pins move only after "Move this item", and cable ends move with them as one undoable step (`EquipmentLayer.tsx`).

## Length

**Keep drawn, sheath, optical and slack lengths separate.** Since Phase 3 a cable keeps `lengthMeters` (worked out from the drawn line), sheath marks at both ends with their unit (`sheathMarkStart`, `sheathMarkEnd`, `sheathMarkUnit`), and an OTDR length with date and note (`opticalLengthMeters`); slack is the sum of its slack loops. `cableLengths` in `packages/shared/src/domain/outsidePlant.ts` shows them side by side and never merges them.

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
- Before creating a point, list same-type assets within about 1.5 × GPS radius plus a margin, and ask "same as this one?" with its photo. Field capture does this with its GPS radius; the engineer map and KML import use a fixed radius from the `osp.duplicate.radiusMeters` setting (default 5 m)
- A QR scan opens the existing record
- Spans link existing poles rather than free lines
- Merges keep the older ID, with a pointer

## Import and export

- GeoJSON and KML are longitude first, WGS 84. Six decimals is about 10 cm
- India's latitude (6–38°N) and longitude (68–98°E) do not overlap, so an importer can detect swaps
- Accept KMZ and folders. Keep `name` and `description` as written
- Ask rather than assume a Placemark is a pole or a line is one cable
- Never trust KML length. Drop altitude, which is usually zero

KML and KMZ import exists since Phase 3 (below). It has only been tried with sample files made for the test; try a real operator's file before relying on it.

## Where the codebase stands

Phase 3 (November 2026) built these on branch `feature/easy-mapping`, checked by unit tests and by browser scripts at 1500 and 360 px. No engineer has used them yet and no real KML has been imported, so treat them as built, not accepted.

- **Rules:** `packages/shared/src/domain/outsidePlant.ts` (spans, attachments, ducts, slack loops, permissions, lengths, duplicates, cascades, link checks), `ospSettings.ts` (limits with sources), `kmlImport.ts` (preview and plan). The server runs the same `checkChangeSetLinks` (`apps/server/src/lib/linkGuard.ts`) and refuses a record pointing to something missing with HTTP 409
- **Spans** join two existing structures, with `status` (`proposed`, `planned`, `built`, `verified`) and `basis`. A span is a structure, never a cable. "Next pole" in field capture makes only a `proposed` span with basis `field_sequence`, drawn dashed; the office confirms it in the span panel or in Operations, Field captures
- **Attachments** record one cable on one pole or one span. "Find poles near this line" lists poles within `osp.attachment.corridorMeters` (15 m); none is ticked and nothing is saved until a person ticks each one and chooses how sure. Pole panel: "Cables on this pole"; cable panel: "Poles supporting this route", in order along the line
- **Ducts** are lines with sub-ducts and occupancy, started from a chamber with "Start duct here"; the far end is chosen from a list. One cable cannot be listed twice in a duct
- **Slack loops** are points on a cable at a chosen pole or chamber, with a length entered or worked out from the marks (feet converted)
- **Pole details:** `material`, `heightMeters`, `ownerName` as written (BESCOM, Own, BBMP), `ownerPoleNumber` (the owner's painted number, never the key), `poleNumber`, `tagCode`. Field capture still records only the kind of owner (`ownerType`)
- **Permissions:** authority, kind, permit number, dates, rent and terms as typed, on one or more poles. No rate table or countdown, as `references/india-rules.md` requires
- **Lengths:** flags when optical is more than 1% shorter or 5% longer than sheath, and when sheath differs from drawn plus slack by more than 10% (all settings)
- **KML/KMZ import** (Administration, Backup & KML, or the data menu): preview, a choice per folder and style, existing or planned, optional core count; names, descriptions, folders, styles and ExtendedData kept in `importInfo`; altitude dropped, KML lengths ignored, `locationMethod: 'imported'` with no accuracy; swapped, 0,0, out-of-range, multi-part and area features skipped with a reason; likely duplicates held back unless ticked; nothing connected
- **Deleting** a pole or cable removes the spans and attachments that name it and updates ducts, slack loops and permissions, and says so before deleting

- **Buildings (Phase 5):** set up from a Building Entry Point pin (`createBuilding`); kind, floors, riser cable, floor boxes (pin and splitter), units. Each unit's path, OLT to entry to riser to floor box to drop to ONT, comes from `buildingUnitPaths` and names each missing link; a house skips riser and floor box. A pin or cable a building names cannot be deleted. Building permissions stay on the pole permission records

- **Faults on poles and spans (Phase 8):** "Who is affected?" for a pole or span uses only attachment records: a pole with no attachment lists nobody and says why; a cable drawn past it never counts. Damage reported on a pole, span or duct is an alarm on that record

**Known gaps:** KML export leaves out spans, ducts, slack loops and buildings. A duct has no "who is affected" of its own yet (choose its cables). No road-crossing clearances or sag; a riser is only a cable on the building record, with no vertical length or route. Manhole cover and inside details are not recorded. Equipment and cables made on the engineer screens still get sequential IDs. Permissions have no expiry reminder in the app (the map check flags a past end date). The old "Duct" and "Fiber Slack Loop" point types still exist beside the new records.
