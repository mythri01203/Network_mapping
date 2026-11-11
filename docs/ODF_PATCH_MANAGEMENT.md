# ODF and patch management

This document covers sites and racks, where an item sits in a rack, the rack drawing, ODF adapters marked faulty or reserved, pigtails and patch cords, and how the fibre behind an ODF adapter is marked in use. It describes the code as of Phase 9 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026.

Code:
- Schemas: `packages/shared/src/model/schemas.ts` (`siteSchema`, `rackSchema`, `odfPortSchema`, equipment `siteId`/`rackId`/`rackUnit`/`rackUnits`, assignment `odfPortId`), `enums.ts` (`RACK_NUMBERINGS`, audit types `Site` and `Rack`)
- Sites and racks: `packages/shared/src/domain/sitesRacks.ts`
- ODF commands: `packages/shared/src/domain/fiberCommands.ts` (`setOdfPortFeeder`, `patchOdfPort`, `markOdfPort`, `saveOdfPortDetails`, `odfPortCounts`, `fiberCascadeForEquipment`)
- Rules: `packages/shared/src/domain/fiberRules.ts` (ODF codes), `sitesRacks.ts` (`findSiteRackProblems`), restore check `restoreCheck.ts` (rule `sites`), server guard `apps/server/src/lib/linkGuard.ts`
- Screens: `apps/web/src/features/fiber/OdfSection.tsx` (with `odfUi.ts`), `apps/web/src/features/olt-rack/` (`OLTRackView.tsx`, `SitesRacksView.tsx`, `RackElevation.tsx`, `SiteRackSection.tsx`), store actions `apps/web/src/stores/plantActions.ts`

## Where the records live

| Record | Stored as | Holds |
|---|---|---|
| `sites` (new collection) | JSON in the records table | `name` (unique), and optional `kind` ("Exchange", "Hub room"), `address`, `lat`/`lng`, `notes`, who and when |
| `racks` (new collection) | JSON in the records table | `siteId` (must exist), `name` (unique per site), and optional `heightUnits` (1 to 60), `numbering` (`bottom_up` or `top_down`), `location`, `notes` |
| Equipment | Existing record, new optional fields | `siteId`, `rackId`, `rackUnit` (the lowest unit it fills), `rackUnits` (how many units tall) |
| ODF port | Inside the ODF's `odfPanels` (as before) | New optional `pigtail` (connector, length, label, notes); the `patch` gains `cordConnectorOdf`, `cordConnectorPon`, `cordLengthMeters` and `override` |
| Fibre assignment | Inside the cable's cores (as before) | New optional `odfPortId`: the adapter that holds this fibre |

No SQL change. The sample network has empty `sites` and `racks`. The older free text on equipment, `site` and `rackNumber`, is kept as it is. When no site or rack record is linked, the screens show that text with "(as written)".

### Pigtails and patch cords: kept inside the ODF port, not as separate records

The plan said "patch cords as records". They are kept inside the ODF port instead, because:

1. **The link already lives there.** Since Phase 4 the patch (`port.patch`: OLT, PON port, when, who) is on the port, and the trace, the PON tree, the "one patch per PON port" rule and the delete cascades all read it there. A separate patch-cord record would hold the same link a second time, and the two could disagree.
2. **One change, one place.** Patching, removing a patch and changing the cord are each one write to one record, with one history on the port.
3. **A cord has exactly two ends here: this adapter and one PON port.** Both are already named by the patch.

The pigtail is the short fibre from the feeder fibre (spliced to it) to the back of the adapter. Its "from" is the port's feeder fibre and its "to" is this adapter, so only its connector, length and label are stored.

Not covered: a cord between two ODF ports (a cross-connect) or a cord to anything other than a PON port. That needs a link the trace understands, so it is left for Phase 13 (connectivity engine). Phase 8 records a pigtail inside a closure (`fiberTerminations`); that is a different place and does not touch ODF ports.

## Sites, racks and where an item sits

- **Add a site and its racks** on the OLT Rack screen, tab **Sites and racks**. A rack's height and unit numbering are only what the person writes. Left empty, they stay "not recorded".
- **Put an item in a rack** from the item: Connectivity tab, **Site and rack**, **Choose site and rack**. Choosing a rack also records its site (the rack stands there). The person writes the lowest unit it fills and, if known, how many units tall it is. The section shows for OLTs, ODFs and FDMS, and for any item that already has a site or rack.
- **The rack drawing** (`RackElevation.tsx`) opens from the rack on Sites and racks and from **Show rack** on the item. Each unit is a row with its number. An item fills its recorded units. Free units are listed in words ("Free, as recorded: units 1, 4, 6 (3 of 6)").
  - No rack height recorded: nothing is drawn as free, and the screen asks for the height.
  - No item height recorded: the item is drawn one unit tall with a dashed edge, marked "height not recorded", and the free count says more units may be taken.
  - Numbering not recorded: units are drawn from the bottom, and the screen says so.
  - Two items in one unit are drawn side by side, marked "shares a unit".
  - Tapping an item opens it.

### Rules

| Code | Kind | What |
|---|---|---|
| `rack_site_missing` | Error | A rack at a site that is not on record |
| `equipment_site_missing`, `equipment_rack_missing` | Error | An item naming a site or rack that is not on record. **Deleting a site or rack still in use is refused this way**, by the browser command (which names what to move first) and by the server |
| `equipment_rack_other_site` | Error | An item in a rack at one site but naming another site |
| `rack_unit_beyond` | Error | An item reaching past the top of a rack whose height is recorded. Lowering a rack's height below what sits in it is refused too |
| `rack_units_overlap` | Warning | Two items recorded in one unit. Half-width items can share a unit, so this asks "Save anyway" and logs it |

Moving a rack to another site moves the items recorded in it with it, after the person confirms. These rules run in the browser, on every server write (`linkGuard.ts`) and on restore (rule "Sites, racks and what sits in them"). Problems already stored are not blamed on a new change. Older backups have no sites, so they pass.

## ODF adapters

### Faulty and reserved

The stored values are the existing `damaged` and `reserved`. The screens say **Faulty** and **Reserved**. `markOdfPort` writes the mark and its reason as a history line on the port. History lines are never deleted.

| Action | Needs | Notes |
|---|---|---|
| Mark faulty | What is wrong | A patch or feeder already on the port stays. It may have gone bad in service |
| Mark repaired | What was done | Back to free or in use, depending on what is on it |
| Reserve | What it is kept for | Only a free port. One with a patch is refused: it is in use |
| End reservation | Reason optional | |

- **A faulty port is refused for a new patch** unless the person writes why. The reason, who and when are stored on the patch (`patch.override`), written to the audit trail (`PATCH_OVERRIDE`), and shown on the port ("Patched while marked faulty: ..."). The port stays marked faulty.
- On the server, `odf_patch_faulty_port` (error) refuses a patch with no override on a port marked faulty before the patch was made. A port that went faulty after it was patched is not blamed.
- **Patching a reserved port** asks first ("Port 5 is reserved (OLT-1 PON-03 next week). Patching it ends the reservation."). If the person goes ahead, the reservation ends and that is written in the history.
- Reserving a port needs **allocate** and ending it needs **deallocate** (Phase 23 table). Patching is **connect**.

### The fibre behind the adapter is marked in use

Before Phase 9, recording the feeder fibre behind an adapter did not mark that fibre used, so it could be given away. Now:

1. **Setting the feeder fibre** gives the fibre an assignment (`kind: in_use`, `equipmentId` the ODF, `odfPortId` the adapter):
   - **Use:** `ODF <name> <panel> port <n>`, or `PON <OLT> / <PON port>` when the adapter is patched. This is the same wording customer setup uses, so customer setup sees the same PON tree and adds nothing.
   - **Source:** the adapter (and the PON port through it).
   - **Destination:** the cable's other end, only when the cable is recorded as ending at this ODF. Otherwise it is left out, not guessed.
2. **Patching, unpatching, deleting the OLT** releases the port's assignment and gives a new one with the new use. The old one stays in the fibre's history with the reason ("ODF ... patched to OLT-1 PON-01").
3. **Removing the feeder fibre, or deleting the ODF,** releases the assignment. The fibre goes back to Available unless it is marked damaged, faulty or retired.
4. **Assignments something else made are never changed.** For example, a customer setup assignment on an older port. The notice says the fibre stays recorded for that use and to release it on the Fibers screen if nothing uses it.

The same rules as `assignCore` (Phases 0B and 7) apply when a new feeder fibre is recorded:

| The fibre is | Result |
|---|---|
| Already in use or reserved for something else | Refused: "Release it on the Fibers screen first, or choose another fiber" |
| Already in use for the PON port this adapter is patched to | Kept as it is. No second assignment |
| Marked In Use or Reserved with no record of what for | Refused, as in Phase 0B |
| Retired | Refused |
| Damaged or faulty | Refused unless the person writes why. The reason is kept on the assignment (`override`) and in the audit trail (`CORE_OVERRIDE`) |

When the fibre is assigned because a patch changed (not a new feeder), these cases are not refused: the patch is a physical fact. The fibre is left as it is, and the notice says why.

Older ports from before Phase 9 have a feeder fibre that is not marked. The warning `odf_feeder_not_marked` lists them. The port screen says "This fiber is not marked in use. Save the feeder fiber again to mark it." Nothing is changed for the person.

### Pigtail and patch cord details

On the port screen:
- **Record pigtail:** connector, length (m) and label.
- **Patch cord** (when patching, or **Change cord details** later): cord label, the connector at this adapter, the connector at the OLT, and the length (m).

Common connector names are offered as suggestions only. Nothing is pre-filled except the values already recorded. History lines name the cord ("Patched to OLT-1 PON-01 (cord PC-9, SC/APC to SC/UPC, 3 m)").

`odf_connector_mismatch` (warning) flags a pigtail or cord end of another kind than the adapter (LC into SC), or APC against UPC. It is read from the text as written, and nothing is said when either side is not recorded.

### The port screen

- Each adapter is a tile at least 48 px on a phone, with its number and a mark, never colour alone: ● patched with a fibre behind, ◐ only one side recorded, ✕ faulty, R reserved, blank free.
- A count line, worked out from the ports: patched, with a fibre behind, faulty, reserved, free.
- Opening a port shows its state with the reason, the back (fibre, whether it is marked in use, pigtail) and the front (patch and cord), the mark buttons, and the history, newest first.

## Tests

- `packages/shared/test/odfPatch.test.ts`:
  - The feeder marks its fibre with source and destination, and releases it with history.
  - The assignment follows the patch.
  - A held, unrecorded or faulty fibre is refused without a reason; with one, the reason is kept.
  - Deleting the OLT gives the fibre back to the port.
  - Older unmarked ports are warned about.
  - Permissions: allocate and connect.
  - A faulty port is refused for a new patch without a reason; with one, the reason is stored. The server rule catches a patch written straight to the record, but not one made before the fault.
  - Reserve, patching a reserved port, repair.
  - Pigtail and cord details; connector warnings.
- `packages/shared/test/sitesRacks.test.ts`:
  - The collections are registered and empty in the sample.
  - Duplicates are refused.
  - Placing an item and clearing it.
  - Free text "(as written)".
  - Past the top of the rack refused; overlap warned.
  - Moving a rack takes its items.
  - Deleting a site or rack in use is refused (command and server rule).
  - Restore check.
  - Rack drawing with and without a height.
  - Who may change sites and racks.
- `apps/server/test/phase9odf.test.ts`:
  - Sites and racks stored.
  - Links to records that are not on file refused.
  - Past the top of the rack refused.
  - Deleting a site or rack in use refused, then allowed once empty.
  - A faulty-port patch with no reason refused, and one with a reason stored.
- `apps/web/src/features/olt-rack/rackElevation.test.tsx`:
  - The drawing's rows and free units.
  - No height means nothing called free.
  - The store saves sites, racks and an item's place, refuses a rack delete in use, and undo covers it.
  - Port tiles say their state in words.

## Known gaps

- **Not tried in a browser.** No walkthrough was run for this phase (not allowed for this helper), so Workflow F has been checked only by unit and server tests.
- **Rack face:** front and rear mounting are not recorded, and depth is not checked.
- **Cross-connects:** cords between two ODF ports, and cords to anything other than a PON port, are not recorded (Phase 13).
- **Other roles:** the NOC Operator and Supervisor rules do not cover sites and racks, so those roles cannot change them. Field technicians cannot either: sites and racks are office records.
- **Site position:** a site's map position can be recorded through the API, but the Sites screen has no map picker yet, and sites are not drawn on the map.
- **Map check:** the map-check script (`.claude/skills/fibergis-map-check`) does not yet run the site and rack rules or `odf_feeder_not_marked`.
