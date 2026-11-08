---
name: fibergis-ftth-mapping
description: Engineering rules for FTTH, GPON, EPON and fiber mapping in FiberGIS. Use whenever work touches OLTs, PON ports, ODF, feeder or distribution or drop cables, tubes, cores, fiber color codes, splices, closures, splitters, FAT or FDT boxes, ONT or ONU, optical power, Rx levels, loss budgets, traces, or any question about whether a fiber path or number is right, even if GPON or FTTH is not named.
---

# FTTH and GPON mapping

Use this to build features and to answer engineering questions. Pair it with `fibergis-data-truth`, which covers how values are stored and shown.

Exact numbers and their sources are in `references/optical-values.md`. Read that file before writing or checking any number. Everything numeric ships as editable settings.

## A valid path

A path is a gapless chain with a named port or core at every step:

**OLT PON port → patch → ODF port → splice → cable core → closures and splices → splitter input → splitter output → cores → terminal box port → drop core → ONT**

A trace that loses the chain must name the exact missing link. Since Phase 4, `traceCustomerCores` (`packages/shared/src/domain/fiberPath.ts`) follows one fiber at a time from the drop back to the PON port and names the first missing link; the customer traces use it whenever the fibers are recorded end to end. When they are not, the cable-level route is still shown, but the trace is incomplete and says which fiber link is missing.

## Answering "will this link work?"

1. Add up the loss for each direction: fiber at that wavelength, splitters, splices, connector pairs.
2. Compare with the class range, both ceiling and floor. Use the class budget (28 dB for B+) for the verdict, not launch minus sensitivity, which gives 28.5 dB. Keep any 3 to 5 dB margin separate.
3. Report one of four verdicts: **too little loss**, **fits with margin**, **fits but under margin**, or **over budget**.
4. Expected Rx = launch − loss. Launch is a range (+1.5 to +5 dBm for a B+ OLT), so use the port's real Tx if known, or give a range.
5. Say which inputs are standards and which are proposed defaults. "Fits" is only as good as the defaults, so also try the conservative values, and get the installed splitter's datasheet before signing off.

## Rules

| Rule | Severity |
|---|---|
| A core or port has one continuation on each side; one occupant per core | Error |
| Two OLT ports reach one splitter tree, unless a declared dual-input splitter | Error |
| Splitter output loops back into its own tree | Error |
| Recorded splitter loss below ideal `10·log10(N)` by more than 0.1 dB, which allows rounding | Error |
| `tubes × fibers_per_tube` differs from core count | Error |
| Path loss too high or too low for the port's class, checked upstream and downstream | Strong warning. Not blocking, because it rests on default losses |
| Spread on one PON above 15 dB or 20 km | Warning |
| Product of split ratios above the configured limit, or ONUs above `max_onu` | Warning |
| Color mismatch at a splice, if both cables share a scheme | Warning. Otherwise compare by number |
| Mapped path differs from OLT export | Warning |

All are proposed validators built on the sources in the reference file. Only the budgets and the 15 dB and 20 km limits come directly from a standard.

## Things people get wrong

**Too little loss is also a fault.** B+ allows 13 to 28 dB. A strong signal can overload the receiver. Flag short, low-split links, especially C+ optics on a short 1:8. First check for a missing splitter or wrong path. If the path is right, an inline attenuator adds loss; FOA notes attenuators may be needed. Size it from the real launch power.

**Calculate each direction per wavelength.** 1490 nm down and 1310 nm up have different fiber loss, and 1310 is usually the limit. An ONT reading checks downstream only, so also store the OLT's per-ONT upstream reading.

**Split and reach are separate limits.** Keep the optical budget apart from `olt_port.max_onu`, which comes from the vendor. Sources disagree on maximum split (64 or 128).

**Store the optics class per PON port.** Labels are unreliable: one "PX20" part has PX20+ sensitivity, and vendors sell "B+" optics claiming 29.5 dB. Show the ITU class and vendor budget separately.

**Color is a lookup that needs a known scheme.** TIA-598 is common but not universal, and IEC schemes reorder it. No TEC or BSNL table could be found. Store a scheme per cable, use the fiber number as identity, and never generate colors for an unknown scheme. Numbering: `(tube − 1) × fibers_per_tube + fiber`. Do not assume 12 per tube; use `coreIdentity` from `packages/shared/src/fiber/colors.ts` (the old `getFiberColor` and `getTubeNumber` assume TIA-598 with 12 per tube and are kept only for map line colours). Field message: "Blue may not be fiber 1. Check the drum."

**Keep vendor addressing as written.** Huawei `gpon 0/5/0 ont 1`, ZTE `gpon-onu_1/x/y:n`, Nokia `1/1/1/2/33`, BDCOM `ePON 0/1:5`. Store vendor, ordered parts and the raw string. Do not convert between formats. These come from third-party guides, so check a real device export before building import.

**Names differ between operators.** FDT, FDH, FAT, NAP, FMS, FPOI and FTB overlap. Model functional types (`termination_frame`, `splice_closure`, `splitter_enclosure`, `access_terminal`, `premises`) with operator aliases.

**Unequal couplers lose differently per port.** 10/90 is about 11.3 and 0.6 dB, so one loss field is a modelling error.

**Predicted against measured Rx is the cheapest whole-path check.** A gap above about 3 dB (proposed) suggests a dirty connector, a bend, the wrong path or a wrong ratio. It needs the OLT's actual Tx, because the allowed launch range alone spans more than 3 dB.

## Known gaps in this codebase

Phase 4 (November 2026) added the fiber path. What exists now, and what is still missing:

- **Built:** colour schemes are data (`packages/shared/src/fiber/colors.ts`: TIA-598, IEC 60304 with a source caveat, "not known", and operator schemes as `fiber.scheme.<key>` settings). Each cable stores `colorScheme`, `tubeColorScheme` and `fibersPerTube`; identity is `coreIdentity`, colour only when the scheme is known. Older cables are "not known", never TIA-598
- **Built:** core assignments with history (`fiberCommands.ts`: `assignCore`, `releaseCore`, `coreUtilization`); customer setup marks the drop core and, when the core path is recorded, the feeder and distribution cores (`markServingCores`)
- **Built:** closures with trays and cable entries; splices with tray, type, loss with origin, OTDR ref and history (`recordSplice`, `retireSplice`, `resplice`); ODF panels, ports, feeder core behind each port and patches in front (`addOdfPanel`, `setOdfPortFeeder`, `patchOdfPort`); PON port vendor address as written, optics class, vendor budget, ONU limit (`updatePonPort`); one splitter model with port records, exact input core or cascade parent, per-output loss for couplers
- **Built:** core trace (`fiberPath.ts`: `traceCustomerCores`, `traceCoreUpstream`, `tracePonTree`) with per-direction budgets from `calculateOpticalLossBudget` and the four verdicts; the customer traces in `opticalPathTrace.ts` and `trace.ts` use it when the fibers are recorded end to end, and otherwise name the fiber gap
- **Built:** validators (`fiberRules.ts`, `findFiberProblems`, `newFiberProblems`) run in the browser commands and on the server (`apps/server/src/lib/linkGuard.ts`)
- Connector pairs are counted from the ports on the path (PON port, each ODF port, the access-box output adapter, the ONT), each at the estimated setting. ODF pigtail splices are counted only when recorded as splices
- No loss values for 1577 and 1270 nm: XGS-PON and 10G-EPON use the 1550 and 1310 nm settings and the trace says so. C+ still has no separate receive bands
- Dual-input (2:N) splitters are only a flag (`dualInput`); a core cut mid-span inside an express closure is not modelled
- A restore from backup is not checked against the fiber rules, so an older backup still loads; the map check reports its fiber problems
- Mapped path against an OLT export, and spread checks against real readings, need Phase 7
- **Built (Phase 5):** ONT records apart from customers (`onts`, `connectionCommands.ts`): serial as entered, the OLT's ONU address as written (never converted), PON port, splitter output and drop fiber, `single` or `shared` (MDU) arrangement, swap and move with history. Customers on one shared ONT may share one drop fiber without a `core_two_continuations` error
- **Built (Phase 5):** disconnect and move release and re-give fibers and outputs through the same rules (a used output or fiber is refused in the browser and on the server); the OLT link is worked out again from the recorded fibers
- **Built (Phase 5):** logical tree OLT → PON → splitter stages → ONT → customer → services (`serviceTopology.ts`), walked downstream from each PON port, gaps named
- **Built (Phase 5):** predicted against measured Rx (`reconciliation.ts`): a value only with the port's recorded `txPowerDbm`, otherwise the class launch range; flagged beyond `optical.measuredGap` below or `optical.measuredStrongGap` above (3 dB each, proposed). The next action is plain ("Clean and check the connector at the box"). Upstream (OLT per-ONT) readings are not stored yet; that needs Phase 7
- The PON ports' real Tx is rarely recorded, so most reconciliations will say "record the real launch power"; get it from the OLT
- **Built (Phase 8):** who is affected by a fiber, cable, closure, splitter, PON port or OLT (`affectedByElement`, `faultImpact.ts`) and suspected shared causes for alarms (`correlateAlarms`), both from `traceCustomerCores` paths only. A customer whose fibers are not recorded end to end is "may be affected" when their own record names the element, never assumed. Elements on exactly the same path (a splitter and the fiber feeding it) cannot be told apart by alarms; the splitter, nearest the customers, is named first and the others listed on it. No OLT alarms exist (Phase 7), so LOS and low-light alarms are typed by people or TEST events; a field check reading is `field_measured` with the meter photo
- **Gap (Phase 8):** correlation does not weigh splitter ratios or optical budgets, and treats "no alarm" as unknown, not up

## Explaining to field staff

Keep the arithmetic in the system. Show results as a next action: "Too much light. Check for a missing splitter." Do not show formulas or dB budgets. See `fibergis-easy-field-ux`.
