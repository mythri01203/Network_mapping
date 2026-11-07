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

A trace that loses the chain must name the exact missing link. Today `traceNetworkPath` (`packages/shared/src/domain/trace.ts`) reads core status and averages closure splice loss, but it does not follow one core through to the next. `traceOpticalPath` uses only linked records and names each missing link, but it is also cable level. So neither can yet prove light reaches a customer.

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

**Color is a lookup that needs a known scheme.** TIA-598 is common but not universal, and IEC schemes reorder it. No TEC or BSNL table could be found. Store a scheme per cable, use the fiber number as identity, and never generate colors for an unknown scheme. Numbering: `(tube − 1) × fibers_per_tube + fiber`. Do not assume 12 per tube; `packages/shared/src/fiber/colors.ts` currently does. Field message: "Blue may not be fiber 1. Check the drum."

**Keep vendor addressing as written.** Huawei `gpon 0/5/0 ont 1`, ZTE `gpon-onu_1/x/y:n`, Nokia `1/1/1/2/33`, BDCOM `ePON 0/1:5`. Store vendor, ordered parts and the raw string. Do not convert between formats. These come from third-party guides, so check a real device export before building import.

**Names differ between operators.** FDT, FDH, FAT, NAP, FMS, FPOI and FTB overlap. Model functional types (`termination_frame`, `splice_closure`, `splitter_enclosure`, `access_terminal`, `premises`) with operator aliases.

**Unequal couplers lose differently per port.** 10/90 is about 11.3 and 0.6 dB, so one loss field is a modelling error.

**Predicted against measured Rx is the cheapest whole-path check.** A gap above about 3 dB (proposed) suggests a dirty connector, a bend, the wrong path or a wrong ratio. It needs the OLT's actual Tx, because the allowed launch range alone spans more than 3 dB.

## Known gaps in this codebase

- Tube colors are not stored; only the tube number is
- Trays, ODF panels and patch records do not exist, and closures cannot be created in the app
- Placing a splitter on the map creates no port records (`trace.ts:69,206`)
- Feeder and distribution cores are not marked as used during customer setup
- Since Phase 1 all optical numbers come from `packages/shared/src/domain/opticalSettings.ts` (the values in the reference file, each with a source note) and can be overridden in Administration, Optical settings. The worked examples are tests in `packages/shared/test/opticalSettings.test.ts`. Do not add a number elsewhere
- No optics class is stored per PON port, so traces check GPON against B+ and say so in their notes. C+ has no separate receive bands yet
- Traces work at cable level: connector pairs are counted one per equipment on the path and labelled estimated; only recorded splices are counted

## Explaining to field staff

Keep the arithmetic in the system. Show results as a next action: "Too much light. Check for a missing splitter." Do not show formulas or dB budgets. See `fibergis-easy-field-ux`.
