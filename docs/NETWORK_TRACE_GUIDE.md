# Network trace guide

**Network mapping Phase 15, 11 November 2026.** One trace engine for the fibre links, the 12 kinds of trace, the state of each step, the map highlight, the diagram and the downloadable report.

## One engine, on the recorded links

Before this phase there were two trace engines that could disagree (audit section 5). `trace.ts` followed cable ends and the customer's own fields; `fiberPath.ts` followed fibre links. The map highlight used the first.

Now every trace on the screens goes through **one engine**, `packages/shared/src/domain/networkTrace.ts`. It is built on the Phase 13 connection index (`connectionIndex.ts`). The rules:

- **Only physical links that a record holds are followed.** These are splices, ODF feeder fibres and patch cords, OLT feeders, splitter inputs, outputs and cascades, drop fibres and ONTs.
- **Nothing is followed from position.** Being near a box, or which cables end at a box, never makes a link.
- **"As written" copies are not followed.** Examples are the splitter written on an OLT port, the customer written on a splitter output, the box written on a fibre, and port notes. They are shown on the item screens, where a disagreement is visible.
- **Cable TV links are not followed here.** They are traced with the RF tree on the Cable TV screen.
- **A gap is never filled in.** The trace stops at the first missing link and says what is missing and where to record it.
- **Two feeds on one fibre is a gap.** No feed is picked.
- **A faulty step is followed on.** The record says the link is joined, so the trace shows the route past it and marks the step faulty. That helps find a fault. It never makes the path "working".

### What happened to the older engines

| Engine | Where it is still used | Why |
|---|---|---|
| `fiberPath.ts` (`traceCustomerCores`, `traceCoreUpstream`, `tracePonTree`) | The loss budget per wavelength (Route Trace screen), fault impact, provisioning, the customer path check | It works out the optical loss, and the new engine gives the same fibres (proved by a test). Nothing that works was replaced |
| `trace.ts` (`resolveTraceTarget`, `traceCustomer`, `traceEquipment`, `traceCable`) | The **cable-level route** only: "Cables and loss estimate", and the physical route when no fibre is recorded | Where only cables are recorded, it is the honest answer. It is always labelled **"Cables only"** |
| `opticalPathTrace.ts` | The Route Trace screen's loss estimate | Unchanged |

The inspector "Trace" buttons (`traceNetworkPath`) used to open the cable-level route. They now open the new trace screen. The old route view is one tap away ("Cables and loss estimate"), through `traceCableRoute`. Every old export still works.

**Proof that they agree.** In `packages/shared/test/networkTrace.test.ts`:

- On the bundled sample network, and on a network built with the commands people use, the new engine gives the same fibres in the same order as `fiberPath.ts`.
- It reaches the same OLT port and is complete in the same cases.
- Where the fibres are recorded end to end, it gives the same cables as the cable-level `trace.ts`.
- On the sample (which records no fibre end to end), the physical route is the cable-level route, labelled "Cables only", with exactly the cables `trace.ts` follows.
- Where `fiberPath.ts` stops at a faulty or planned step, the new engine shows that step as faulty or planned.

## The 12 traces

| Trace | Start | What it gives |
|---|---|---|
| Between two items (`asset_to_asset`) | Two points of any kind | The path joining them, in one of three forms: one feeds the other; both share a feed (two paths from the shared step); or "No recorded link joins them" |
| Between two cables (`cable_to_cable`) | Two cables | The same, for cables |
| Between two fibres (`core_to_core`) | Two fibres (`CABLE#N`) | The same, for fibres |
| Between two ports (`port_to_port`) | PON ports, ODF ports, splitter outputs | The same, for ports |
| OLT to every ONT (`olt_to_ont`) | An OLT or one PON port | The tree of everything it feeds, down to each ONT and customer |
| Customer to OLT (`customer_to_olt`) | A customer or ONT | The fibres from the house to the OLT port |
| Splitter to its customers (`splitter_to_customers`) | A splitter, or one output | The tree below it |
| Towards the OLT (`upstream`) | Any point | One path per fibre of the point |
| Towards customers (`downstream`) | Any point | One tree per fibre of the point |
| Physical route (`physical_route`) | Any point, or two points | Each cable on the path, with its recorded stretches, ducts, poles and spans (the underground and aerial route). With no fibre recorded, the cable-level route, labelled "Cables only" |
| Service path (`logical_service`) | A customer, service or ONT | The fibres, then the service view's branch: PON port, splitter outputs, ONT and services. VLAN and service binding are shown only where they are recorded |
| Who a fault affects (`fault_impact`) | A fault, or any item, cable, fibre, port, splitter or closure | The customers whose recorded path passes through it, and those who "may be affected" because their path is not fully recorded. Uses the existing `faultImpact.ts` |

### Where a point enters the fibre links

| Point | Starts |
|---|---|
| Fibre | That fibre |
| Cable | Every fibre of it with a link on record |
| OLT | Its PON ports |
| ODF | Its ports with a patch cord or a feeder fibre (pick one port, or all) |
| Box | The splitters inside it, and the splices of its closures |
| Closure | Every splice in service (pick one splice, or all). Towards the OLT from the fibre each splice feeds; towards customers from the fibre feeding it |
| Splitter | Its input (pick one output, or the whole splitter) |
| Customer, ONT | The drop fibre (customer and ONT both named: the customer's fibre is followed, and a disagreement is noted) |

An item with no link of its own, such as a box with no splitter, says so. For such an item, trace one of its cables, or use the physical route.

You can type any id: a customer, ONT, item, cable, closure, splitter, fault or service, `OLT/PORT` for a PON port, or `CABLE#N` for a fibre. You can also tap **Use the selected item**.

## The steps

Each step is one of these, listed from the OLT side first:

- equipment (OLT)
- port
- ODF port
- cable, then tube (when the layout is recorded), then fibre
- splice
- splitter (with its output)
- ONT
- customer
- connector (pigtail)
- service
- route (physical route)
- missing link
- note

Each step has a **state**, with a mark and words, never colour alone:

| State | Mark | Meaning |
|---|---|---|
| Checked good | ✓ | On record, and every link here has a passing check |
| Not checked | ○ | On record, but a link here has no check, an out-of-date check (the link changed since), or a check that could not tell. This comes from the Phase 13 link checks. It is always shown, never hidden |
| Check | ! | Under maintenance, or similar |
| Planned, not done | ◷ | A planned splice (the trace stops there), a planned cable, a customer pending installation, an ONT in stock |
| Faulty | ✕ | Any one of these: marked damaged, faulty or failed; a link whose last check failed; an open real fault names it (a TEST fault never does) |
| Missing link | ⚠ | A gap. The trace says what is missing |

Each link passed at a step is listed under it: its kind, its check state, and where it is recorded.

## On the map, the diagram and the report

- **Map highlight.** Every trace highlights its cables and items. Fibre-level traces are included (`useTraceStore.showNetwork`). "Show on map" zooms to the whole trace; each step has its own "Show on map". "Clear from map" removes the highlight.
- **Diagram.** A simple tree drawing (`TraceDiagram.tsx`). Paths run straight down with the OLT at the top; downstream traces branch. It is readable on a 390 px phone. After 400 steps the drawing stops and says so; the list and the report keep every step.
- **Report.** "Report (PDF)" uses the existing jsPDF. "Table (CSV)" goes through the shared safe writer: quotes are escaped and formula cells are kept as text. Both come from `buildTraceReport` (`traceReport.ts`), so they say the same as the screen. Each row gives the part, the step, what it is, its name and detail, state, why, the links and their checks, the record ids, and the position as recorded. A customer's house position is never written in a report.

## Screens

- **Fiber Tools, Network Trace**. Also any inspector "Trace" button, and "Fibre by fibre" on the cable route screen ("Cables and loss estimate"). Choose what to trace and where to start, with a second point for the "between" traces, then tap **Trace**.
- Targets are at least 48 px, and the screen works at 390 px wide.
- Personal data follows Phase 12. The screen shows customers as this account may see them (the store is already redacted by the server).
- Everything is read from this organisation's records only (Phase 23b).

## Files

| Part | Files |
|---|---|
| Engine | `packages/shared/src/domain/networkTrace.ts` |
| Report | `packages/shared/src/domain/traceReport.ts` |
| Screens | `apps/web/src/features/trace/NetworkTraceModal.tsx`, `TraceDiagram.tsx`, `traceExport.ts`, `networkTraceActions.ts`, `traceGraph.ts`; `apps/web/src/stores/traceStore.ts` |
| Tests | `packages/shared/test/networkTrace.test.ts`, `packages/shared/test/validation.test.ts` (report), `apps/web/src/features/trace/networkTrace.test.tsx` |

## Known gaps

- The trace screen is in English only, like the other engineer screens.
- The new engine gives no loss figure. The loss budget per wavelength stays on the Route Trace screen (`fiberPath.ts` and `opticalPathTrace.ts`), which follow the same fibres.
- A cascade from a splitter output that is not in the splitter's own output list is not drawn in the downstream tree.
- Cable TV (RF) links are not followed here: use the Cable TV screen.
- No browser walkthrough was run for this phase (not allowed in this run).
