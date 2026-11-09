---
name: fibergis-cable-tv-mapping
description: Rules for mapping Cable TV and HFC networks in FiberGIS, including LCO and MSO plant. Use whenever work touches headends, optical transmitters, EDFA, optical nodes or mini-nodes, RF amplifiers, taps, coaxial cable, set-top boxes, cable modems, CMTS, DOCSIS, dBuV or dBmV levels, TV over fiber, or a network carrying both internet and TV, even if the user only says "cable" or "TV line". Do not apply PON splitter or core rules to RF equipment.
---

# Cable TV and HFC mapping

Numbers and sources are in `references/rf-values.md`. Read it before writing or checking any value.

## How sure we are

**This is the weakest area of the research.** Indian practice rests almost entirely on vendor listings. No survey of LCO plant, DOCSIS share or real operating levels was found. Say so when it matters, make values switchable profiles, and do not fix HFC defaults until someone has interviewed 5 to 10 operators and sampled real records. That is the most valuable next step for this area.

## The model

**HFC is a directional RF tree that can carry power.**

Headend → optical transmitter → fiber → optical node → coax with amplifiers → taps → drop → set-top box or modem

Compared with PON, it adds gain stages, loss that rises with frequency, optional return paths and AC power on the coax. Direction belongs to the path, not to how the line was drawn. Level calculation is per frequency.

**Likely Indian LCO picture (inference, not fact):** 1550 nm EDFA feeding low-cost mini-nodes, one-way RF for TV, with data on GEPON sharing the fiber. Keep CMTS, modem and return path optional, because older MSO DOCSIS plant may exist.

**Overlay: model a fiber span once, with a list of wavelengths,** and run two calculations over it: the PON budget in dBm, and the video path from EDFA port to receiver in dBm, then dBµV from the receiver onward.

## Rules

| Rule | Severity | Basis |
|---|---|---|
| Optical connects to RF only through a node, receiver or R-ONU | Error | Definition |
| 1310 nm transmitter into an EDFA | Error | EDFA band is 1545–1565 nm |
| PON wavelengths through a plain CATV EDFA | Error | Needs a WDM EDFA with a pass port (Excerpt) |
| Amplifier input faces upstream, outputs downstream | Error | Datasheet |
| APC to UPC mismatch | Warning | Port types |
| Tap IN and OUT stay on the line; drop ports feed only drop, ground block or subscriber splitter | Warning | Inferred |
| Power calculated only along AC-passing elements; warn at minimum voltage or leg over-current | Warning | Trade paper |
| Amplifier cascade over a configured limit | Warning | No standard limit found |
| Total OFDM power used to set levels | Warning | Field poster: use 6 MHz-referenced level |
| Reading above the upstream level minus passive loss | Warning | Passive parts cannot add signal |

All are proposed validators, not a standard. Feeder-end termination and 75 Ω terminators on unused tap ports are trade lore this research could not source: ship them as soft prompts and have an RF engineer review them.

## Things people get wrong

**The 60 dB unit error.** dBµV = dBmV + 60. Indian meters use dBµV, and DOCSIS papers use dBmV. Store the unit with every value and show both. For entry, lock the pad to the meter's unit.

**Test points read low.** A reading at a 20 dB test point under-reports by 20 dB unless `test_point_loss_db` is recorded.

**"Mini-node" means two things.** Passive and powered units share the name, and the passive budget is far tighter. Make `powered: yes/no` mandatory, and record optical input for every passive node.

**Umax is a rating, not a target.** Store each node's designed levels instead of assuming one.

**Taps have two different numbers.** Through loss and tap value are separate, and through loss falls as tap value rises. Vendors disagree, so catalogue parts rather than ship a generic table.

**Amplifiers are configurable objects.** Output count, filter and return split depend on plug-ins. Do not hard-code them.

**Do not require DOCSIS,** and make thresholds profiles: Indian TV STB, DOCSIS 3.0, DOCSIS 3.1.

**Devices that report nothing.** Taps, splitters, coax and probably Indian passive nodes expose no data. Their levels are calculated or metered, so label them that way. EDFAs may report over SNMP, modems over status pages. A meter comparison across tap, ground block and outlet isolates drop or home wiring faults.

## Measurement record

Port, timestamp, instrument, frequency, level and unit, MER, BER, tilt, technician, origin.

## State of the code

Phase 6 is built from records but **not accepted**. No cable operator was interviewed, so every level is proposed (`docs/IMPLEMENTATION_PLAN.md`, Phase 6).

- Records: `packages/shared/src/model/rfSchemas.ts` (`rfElements`, `rfLinks`, `rfLevels`), kept apart from PON. EDFA, WDM, mini-node, tap, power inserter, set top box and modem are kinds; fiber links carry a wavelength list
- Rules: `domain/rfRules.ts`, `rfTree.ts`, `rfLevels.ts`, `rfUnits.ts`. The server runs the same errors (`apps/server/src/lib/linkGuard.ts`) and on restore. No PON rule touches RF items
- Settings: `domain/rfSettings.ts`, edited in Administration, Cable TV settings (`apps/web/src/features/admin/RfSettingsPanel.tsx`). Only dBµV = dBmV + 60 is a constant
- Page: `apps/web/src/features/cable-tv/` with tabs RF tree, Items, Links, Levels, TV customers, Checks. TV customers are `accessNetwork: 'hfc'` on a tap drop port, not the PON splitter form
- Map check: `rf-*` rules in `fibergis-map-check`
- Still old: the map's node panel (`EquipmentInspector.tsx`) shows labelled example values and the legacy `rfLevelDbf` field (no unit). Do not build on them
