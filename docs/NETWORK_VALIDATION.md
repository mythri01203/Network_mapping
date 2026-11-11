# Network validation

**Network mapping Phase 15, 11 November 2026.** The map check gets geometry rules, the operator's own limits on the server, and stored findings that people mark as fine or fixed, with a history that is never deleted.

**Passing every check does not prove the map matches the street.** A wrong choice that looks right passes every rule. Only photos and site visits catch those.

## Errors and warnings

The project rule is unchanged:

- **An error** is only for impossible or broken data. The server refuses these on every write, as before (Phases 0B to 13).
- **Everything the map check finds is reported, never refused.** The script's "Must fix" findings are stored with severity `error`, so they are listed first. "Fine as it is" is the logged override of a warning.

## Geometry rules

The geometry rules are in `packages/shared/src/domain/geometryRules.ts`. Every one only warns: nothing is changed, moved, merged or linked by them.

| Rule | Finds | Limit (setting) | Fix text |
|---|---|---|---|
| `route-self-intersects` | A cable or duct line that crosses itself. Touching at a shared point is not a crossing, and neither is a closed ring touching its own start | None | Edit the route; if it is a real slack coil, mark it fine |
| `route-extra-point` | Two points of one line closer together than the limit (a double tap) | `validation.geometry.minVertexSpacingMeters`, default 1 m | Remove the extra point |
| `cable-end-gap` | A cable end drawn farther from its item than the limit. A customer end is named by id, and the house position is never stored | `validation.geometry.cableEndGapMeters`, default 50 m | Move the line end, or change what the cable connects to |
| `asset-outside-zones` | An item outside every drawn zone boundary. Only when at least one zone has a boundary (3 or more points) | None | Check the place, or widen the zone |
| `route-duplicate` | Two cables with the same two ends whose lines run together, once per pair. Reuses Phase 5 `findDuplicateRoutes` | `osp.duplicateRoute.corridorMeters` (10 m) and `osp.duplicateRoute.overlapPercent` (80%) | Delete the copy, or mark it fine (a spare or a ring) |

`cable-end-gap` replaces the map-check script's own `cable-end-far` in stored findings and in the summary, so one problem is never listed twice.

## The operator's limits

Before this phase, the server's map check used the script's `DEFAULT_LIMITS` and ignored the operator's settings (audit section 5). Now `checkLimitsFrom(settings)` (`validationSettings.ts`) builds every limit from the settings records:

| Script limit | From | Default | Source |
|---|---|---|---|
| `rxLowDbm`, `rxOverloadDbm` | Optical settings `optical.rx.sensitivity`, `optical.rx.overload` | −27, −8 dBm | G.984.2 B+ |
| `cableEndGapMeters` | `validation.geometry.cableEndGapMeters` | 50 m | Proposed (fibergis-map-check) |
| `duplicateRadiusMeters` | `validation.mapCheck.duplicateRadiusMeters` | 2 m | Proposed |
| `stackedRadiusMeters` | `validation.mapCheck.stackedRadiusMeters` | 1 m | Proposed |
| `attachmentGapMeters` | `validation.mapCheck.attachmentGapMeters` | 30 m | Proposed |
| `lengthDifferenceRatio` | `validation.mapCheck.lengthDifferencePercent` | 10% | Proposed |
| `splitterLossToleranceDb` | `validation.mapCheck.splitterLossToleranceDb` | 0.1 dB | Physics (10·log10 N), rounding allowance |

A value that is the wrong type or impossible is ignored, and the default is used. The settings are edited under **Administration, Poles and routes settings, Map check settings**. Each shows its default and its source, and each change is in the audit trail.

## Stored findings (`validationFindings`)

**Run.** "Check the map now" (Insights, Map Check) calls `POST /reports/validation-run`. The server:

1. Runs the script and the geometry rules with the operator's limits.
2. Compares what it finds with the stored findings (`reconcileFindings`) by a stable key: the rule and the record ids.
3. Writes only what changed, through the normal guarded write, so the write is audited (Phase 23a) and kept to this organisation (Phase 23b).

| What happens | Finding |
|---|---|
| A new problem | Opened: state **Open**, "found" |
| Found again | Unchanged. Nothing is written |
| Not found by this run | Marked **no longer found**. Never deleted. Its state is kept |
| No longer found, then found again | "found again", in its history |
| Marked **Fixed**, then found again | Opened again, with the reason "Found again after it was marked fixed" |
| Marked **Fine as it is**, then found again | Stays fine. That is what the person said about it |

**Decisions.** People mark a finding:

- **Fine as it is** (acknowledged). This is audited as `WARNING_ACCEPTED`.
- **Fixed** (resolved).
- **Open again**.

Every decision records who, when and a note. Each change is added to the finding's history.

**Refused on the server** (broken data, `409`), also in a restore:

- A decision with no who, when or note.
- A finding deleted. Findings are history: mark them fixed instead.
- History changed or cut. History can only grow.
- A finding's rule, key or record changed. A new problem is a new finding.

**Personal data.** A finding names customers by id only:

- The script's sentences quote customer names. `scrubCustomerNames` replaces each one with `customer <id>` before it is stored.
- A customer's house position is never stored.

So every role may read findings. "Show on map" for a customer uses the customer record as this account may see it.

**Who.** Super Admin, Network Admin, GIS Engineer and Network Planner run the check and decide. Field Technician, NOC Operator, Supervisor and Read-only can read the findings. Nobody can delete a finding.

## The findings list

**Insights, Map Check** shows the findings:

- A count of findings in each state.
- Filters: Open, No longer found, Fine as it is, Fixed, All.
- Each finding shows:
  - How serious it is, as a mark and words: Must fix, Check this, Good to know.
  - What the rule is.
  - The record id.
  - The message in plain words.
  - **What to do** (fix text).
  - Who decided what, and when.
  - **Show on map** (zoom to the item).
  - **Open the item** (inspector).
  - Fine as it is, Fixed, or Open again, each with a note box. Save stays off until a note is written.
  - The history.

Targets are at least 48 px, and the list works at 390 px wide.

The **Reports** data-quality summary (`GET /reports/data-quality`) uses the same rules and limits. It still returns only rule, level, count and example ids.

## Files

| Part | Files |
|---|---|
| Rules and limits | `packages/shared/src/domain/geometryRules.ts`, `validationSettings.ts` |
| Findings | `packages/shared/src/model/validationFindingSchemas.ts`, `packages/shared/src/domain/validationFindings.ts` |
| Server | `apps/server/src/lib/mapCheck.ts`, `apps/server/src/routes/reports.ts`, `apps/server/src/lib/linkGuard.ts`, `apps/server/src/lib/targetedReads.ts` (`storedFindingsFor`) |
| Screens | `apps/web/src/features/validation/ValidationFindingsModal.tsx`, `apps/web/src/stores/validationActions.ts`, `apps/web/src/features/admin/FieldSettingsPanel.tsx` (map check settings) |
| Tests | `packages/shared/test/validation.test.ts`, `apps/server/test/phase15validation.test.ts`, `apps/web/src/features/trace/networkTrace.test.tsx` |

## Known gaps

- The check runs on the server only. With no server (browser-only mode) the list says so.
- The script's own `DEFAULT_LIMITS` remain the defaults when the skill is run by hand (`node check_network.mjs`). Only the server reads the operator's settings.
- Fix text is written for the geometry rules and the most common script rules. The others get a general line.
- The self-crossing check skips lines over 2,000 points, to keep the run quick.
- Positions use a flat local projection, which is fine for a town but not for lines hundreds of kilometres long.
- No browser walkthrough was run for this phase (not allowed in this run).
