# FTTH / GPON / EPON Engineering Rules for a Fiber Mapping (GIS Inventory) Tool

Evidence labels used below:
- **[STD]** = read in the standard's own text.
- **[STD-2]** = a standard's value reported by a secondary source.
- **[VENDOR]** = datasheet or vendor document.
- **[OPERATOR]** = Indian operator or government tender document.
- **[THUMB]** = rule of thumb or training-level source.

Provenance caveat: values marked "(search excerpt)" came from search-result excerpts of the cited document. I did not open and read those documents in full, so check them before hard-coding. G.984.2 (08/2019), the FTTH Handbook 2017, the BBNL and ITI tenders, the STL/Bharti spec and the FOA colour article were read directly as extracted text.

## Fiber identification: colour sequence, high-count repetition, regional variants, safety of assuming colours

### Takeaway
TIA-598's 12-colour order (blue to aqua) is the dominant convention and is what the Indian operator spec I could read uses. It is not safe to assume, though, because other schemes reorder the same colours, and tube marking beyond 12 differs between sources. Store the colour scheme per cable and make fibre number, not colour, the identity of a core. I could not obtain the TEC colour table.

### Cited Findings
**Base sequence**
- TIA-598 order: 1 blue, 2 orange, 3 green, 4 brown, 5 slate, 6 white, 7 red, 8 black, 9 yellow, 10 violet, 11 rose, 12 aqua. Positions 13–16 (olive, magenta, tan, lime) are specified for 16-fibre MPO. — [FOA colour codes](https://www.thefoa.org/tech/ColCodes.htm)
- Naming varies: "slate" = grey and "rose" = pink. Sterlite's Bharti Airtel spec prints Blue, Orange, Green, Brown, Slate, White, Red, Black, Yellow, Violet, Pink, Aqua. — [STL/Bharti 48F & 96F spec](https://stl.tech/wp-content/uploads/2024/08/Bharti-48F-and-96F-NOVA-SSA-Specs2.4mm.pdf)

**Fibres 13–24 in one tube**
- Sterlite: fibres 13–24 repeat the base colours with a black ring mark, and fibre 20 is natural, or natural with a black ring. "Color codes may be customized based on specific customer requirement." — [STL colour code note](https://stl.tech/wp-content/uploads/2023/04/Color_Codes_of_Optical_Fiber.pdf)
- FOA article: 13–24 use a black tracer, and fibre 20 is black with a white tracer, or clear with a black ring. — [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf)
- Prysmian documents two schemes for 24-fibre tubes: (a) blue and orange binder threads separating two groups of 12, so colours repeat exactly and only the binder distinguishes them; (b) 24 unique colours using black dashes, with fibre 20 a black dash on natural. — [Prysmian colour guide 2025](https://na.prysmian.com/sites/na.prysmian.com/files/2025-10/Prysmian%20Color%20Code%20Guide%20for%20Fiber%20Optic%20Specifications.pdf)
- FOA also says tubes holding more than 12 fibres use binder tape to separate groups. — [FOA colour codes](https://www.thefoa.org/tech/ColCodes.htm)

**Tubes beyond 12 (sources conflict above tube 24)**
- Tubes 13–24 repeat the colours with a black stripe; the black tube takes a yellow stripe. This appears in both [FOA](https://www.thefoa.org/tech/ColCodes.htm) and [Prysmian](https://na.prysmian.com/sites/na.prysmian.com/files/2025-10/Prysmian%20Color%20Code%20Guide%20for%20Fiber%20Optic%20Specifications.pdf).
- Tubes 25–36: **orange stripe, then green stripe for 37–48** per [FOA](https://www.thefoa.org/tech/ColCodes.htm). **Red stripe for 25–36 (red tube with yellow stripe), green stripe from 37** per [Prysmian's TIA-598 table](https://na.prysmian.com/sites/na.prysmian.com/files/2025-10/Prysmian%20Color%20Code%20Guide%20for%20Fiber%20Optic%20Specifications.pdf). Unresolved without the TIA-598 text.

**Observed cable structures**
- Sterlite/Bharti: 96F = 8 tubes × 12F and 48F = 4 tubes × 12F. Tube colours are the first 8 of the sequence (Blue through Black). — [STL/Bharti spec](https://stl.tech/wp-content/uploads/2024/08/Bharti-48F-and-96F-NOVA-SSA-Specs2.4mm.pdf)
- FOA gives 96F (8×12F) and 24F (4×6F) as example builds, which shows 24F has no single structure. — [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf)
- A Prysmian Australia chart shows a six-colour tube sequence for multi-tube cable (search excerpt). — [Prysmian AU chart](https://australia.prysmian.com/sites/australia.prysmian.com/files/media/documents/Optical%20Fibre%20Cable%20-%20Colour%20Chart_0.pdf)

**Other schemes (same 12 colours, different order)**

| Pos | TIA-598 / ISO 11801 | IEC 60304 / DIN-0888 | IEC 60794-2 | S12 | FIN 2012 | Type E |
|---|---|---|---|---|---|---|
| 1 | blue | red | blue | red | blue | red |
| 2 | orange | green | yellow | blue | white | blue |
| 3 | green | blue | red | white | yellow | white |
| 4 | brown | yellow | white | green | green | green |
| 5 | slate | white | green | yellow | grey | yellow |
| 6 | white | grey | violet | grey | orange | grey |
| 7 | red | brown | orange | brown | brown | brown |
| 8 | black | violet | slate | black | turquoise | black |
| 9 | yellow | turquoise | aqua | violet | black | orange |
| 10 | violet | black | black | orange | violet | violet |
| 11 | rose | orange | brown | turquoise | pink | pink |
| 12 | aqua | pink | pink | pink | red | turquoise |

Source for the table: [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf). It also lists operator schemes (KPN, Antel, Turkcell and others) and says to double-check which version applies.

- IEC 60304's status is reported inconsistently. FOA presents it as a sequence paired with DIN-0888, the [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf) says only that fibre colours "correspond to standard colours in IEC 60304", and a search excerpt describes it as the basic 12-colour set. IEC TR 63194:2019 is the guidance report on colour coding. — [IEC TR 63194](https://standards.iteh.ai/catalog/standards/iec/604faf3f-23a5-44ab-a4d7-f38d073ac438/iec-tr-63194-2019)
- Some systems identify tubes by position, not colour. Type E uses only red, blue and white tubes. — [Hexatronic chart](https://www.hexatronic.com/hubfs/bu-he/content-offer/Color-Codes-and-Counting-Directions-for-Fiber-Optic-Cables.pdf); [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf)
- Counting is clockwise per FOA; in multi-layer cables counting starts at the innermost layer per Hexatronic. — [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf); [Hexatronic chart](https://www.hexatronic.com/hubfs/bu-he/content-offer/Color-Codes-and-Counting-Directions-for-Fiber-Optic-Cables.pdf)

**Safety of the assumption**
- "There are many exceptions for color codes for individual fibers and buffer tubes", arising from national standards and customer requirements. — [FOA colour codes](https://www.thefoa.org/tech/ColCodes.htm)
- FOA states that following fibre numbers is one of the most reliable ways to ensure consistent connections. Colour matching is not always feasible, especially with fewer than 12 fibres per tube, and mismatches should be decided before installation and flagged in documentation. — [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf)
- An Indian power-sector specification accepts EIA/TIA-598, IEC 60304 or Bellcore GR-20 (search excerpt), so more than one scheme is contractually possible in India. — [OPGW specification on Scribd](https://www.scribd.com/document/339798841/Section-02-OPGW)

### Inferences
- **Data model:** `cable.colour_scheme` (enum plus custom), `cable.fibres_per_tube`, `cable.tube_count`. A core's identity is `(tube_position, fibre_position)` and absolute number; colour is derived display data, never the key.
- **Derived absolute number:** `(tube_position − 1) × fibres_per_tube + fibre_position`. Under 12F tubes, core 49 is tube 5 (slate), fibre 1 (blue).
- **Expected builds at 12F per tube (arithmetic, confirm per cable):** 24F = 2T, 48F = 4T, 96F = 8T, 144F = 12T, 288F = 24T, with tubes 13–24 striped. Also allow 6F-per-tube builds, since 24F = 4×6F is documented. The tool should validate `tubes × fibres_per_tube = count` rather than assuming a structure.
- **Plain-language guidance:** "Colours tell you the position only if you know this cable's scheme. Record the scheme from the drum or spec sheet. Blue may not be fibre 1."
- **Validation:** warn on a splice joining different colours only when both cables share a scheme; if schemes differ, compare by number. Do not auto-generate colours for cables with an unknown scheme.
- Binder-separated 24F tubes mean colour alone cannot identify a core. The model needs a binder/group field.

### Gaps
- **TEC / DoT / BSNL colour table: not found.** The TEC GR that surfaced covers HDPE ducts, not fibre colour ([TEC/GR/FA/CDS-008](https://www.scribd.com/document/482701104/TEC-GR-PI-CDS-008-04-AUG-19)). A DoT annexure says only that colour coding must stay distinguishable ([DoT Annex](https://stagingeservices.dot.gov.in/sites/default/files/2024-11/downloadDocument_Annex-Tx.pdf)). I cannot say TEC mandates TIA-598 order. Pull the current OFC GR directly from tec.gov.in.
- TIA-598 itself is paywalled, so tube-25+ marking is unresolved.
- Legacy BSNL and small regional-manufacturer cable colouring in India is undocumented in what I could read.

## Cable types and structure

### Takeaway
Feeder, distribution and drop are network roles, while unitube, multitube, ADSS, figure-8 and armoured are constructions; the two should be separate fields. European core-count ranges do not transfer to small Indian ISPs, which use far smaller cables (6F–24F distribution in the one rollout document I found; 48F/96F in an Airtel spec).

### Cited Findings
**Roles**
- Feeder runs from POP to Fibre Distribution Point, typically in a ring. Sizing differs by operator, and "the majority of these cables are not smaller than 288fo and be in excess of 864fo" (European context). — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Distribution runs from the FDP to terminal boxes, usually not above 1 km, typically 12–96 fibres; it may be ducted, buried, aerial or façade mounted. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Horizontal drop is typically 1–4 fibres; indoor cable 1–4 fibres. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- **India [OPERATOR]:** Excitel's 2019 playbook uses 6F, 12F or 24F distribution cable, with drops described as "2-pair fiber" of approximately 60–80 m and a 100 m design limit from the last splitter. This is a single operator's internal document, not an Indian norm. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)

**Constructions**
- STL's catalogue offers unitube, multitube, ribbon, micro, ADSS (multitube and "mini ADSS" unitube), figure-8 (aerial and flat drop), and steel tape, steel wire, FRP and dielectric armoured variants. Its part-number code separates fibre grade, count, installation (duct, direct burial, aerial self-support, figure-8, drop/riser), buffer structure, fibres per tube, water protection, armouring and jacketing. — [STL OFC catalogue](https://stl.tech/wp-content/uploads/2023/03/OFC_Catalogue_Feb20.pdf)
- ADSS means one or more dielectric units with no metallic components. — [IEC 60794-4-20 preview](https://www.vde-verlag.de/iec-normen/preview-pdf/info_iec60794-4-20{ed2.0}b.pdf)

**Worked India example [VENDOR/OPERATOR]: STL 96F for Bharti Airtel**
- G.657A1 multitube, single sheath, corrugated steel tape armour, FRP central member, jelly-filled tubes.
- 8 tubes × 12F, tube diameter 2.1 +0.2 mm, cable diameter 12.5 mm, 135 kg/km.
- Bend radius 20D, drum lengths 4 km or 2 km (+5%), metre marking accuracy +0.5%/−0%, sequential metre marks printed.
- Source: [STL/Bharti spec](https://stl.tech/wp-content/uploads/2024/08/Bharti-48F-and-96F-NOVA-SSA-Specs2.4mm.pdf)

**Joints in India**
- BBNL's aerial instruction says ADSS is spliced at every joint, "normally at a distance of every 2 kilometre". — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)

**Bend radius by fibre**
- G.652D 30 mm and above; G.657.A1 10 mm minimum design radius; G.657.A2/B2 7.5 mm; G.657.B3 5 mm. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)

### Inferences
- Model `cable.role` (feeder / distribution / drop) separately from `cable.construction`, `cable.installation` and `cable.fibre_type`. The same 24F ADSS can be a feeder for a small ISP and a distribution cable for a large one, so never infer role from count.
- A 2 km drum/joint spacing gives a plausibility check: a long route with no joints or an implausible joint count merits review. This is a heuristic only.
- Do not impose a European feeder minimum. Size warnings should use the operator's own settings.

### Gaps
- No authoritative Indian survey of typical core counts per role. TEC's OFC GRs were not retrieved.
- Tube diameter is documented here for one cable only (2.1 mm); I found no general table of tube sizes by fibres per tube.
- ADSS span and figure-8 messenger limits are product-specific and were not compiled.

## Passive loss values

### Takeaway
Use separate design values per wavelength and treat datasheet "max" values as the design floor. Recommended tool defaults are configurable: fibre 0.35–0.40 dB/km at 1310 and 0.25–0.30 at 1490/1550; fusion splice 0.1; connector pair 0.3–0.5; PLC 1:32 about 17–18 dB. FOA's more conservative splitter table adds up to 2 dB, so the choice materially changes pass/fail results.

### Cited Findings
**Fibre attenuation (dB/km)**

| Source | Type | 1270 | 1310 | 1490 | 1550 | 1625 | Note |
|---|---|---|---|---|---|---|---|
| [Corning SMF-28 Ultra](https://csmedia.corning.com/media/worldwide/coc/documents/Fiber/product-information-sheets/PI-1424-AEN.pdf) (search excerpt) | G.652.D-class, uncabled max | | ≤0.32 | ≤0.21 | ≤0.18 | ≤0.20 | premium fibre, best case |
| [Prysmian BendBright A1+](https://na.prysmian.com/sites/na.prysmian.com/files/media/products/TLS-DS-F-003A-1225_BendBright%20A1%2B%20Bend%20Insensitive%20Single-Mode%20Optical%20Fiber%20with%20Uncabled%20Attenuation.pdf) (search excerpt) | G.657.A1, uncabled | | 0.32 | 0.21 | 0.18 | 0.20 | |
| [STL/Bharti spec](https://stl.tech/wp-content/uploads/2024/08/Bharti-48F-and-96F-NOVA-SSA-Specs2.4mm.pdf) | G.657A1, **cabled max** | | 0.34 | not stated | 0.20 | 0.23 | Indian operator spec |
| [FOA deliverables](https://FoA.org/tech/ref/install/deliverables.html) | G.652/G.657.A1 "reasonable" OSP spec | | 0.4 | | 0.25 | | |
| [Omada guide](https://support.omadanetworks.com/in/document/112365/) | G.652D planning | 0.47 | 0.4 | 0.30 | 0.30 | | also 0.30 at 1577 |
| [Corning 2014 brochure](https://www.icsgroup.ru/upload/medialibrary/8a2/SMF-28_UltraFiberBrochure_10-2014.pdf) (search excerpt) | G.657.A1 limits as Corning reads them | | ≤0.4 | | ≤0.3 | | not the ITU text |

**Macrobend**
- Corning compares one turn at 10 mm radius, 1550 nm: ≤0.50 dB (Ultra) vs ≤0.75 dB (G.657.A1). For 10 turns at 15 mm, 1550 nm: ≤0.05 vs ≤0.25 dB (search excerpt). — [Corning PB115](https://www.corning.com/content/dam/corning/media/worldwide/coc/documents/Fiber/PB115_DE.pdf)
- Prysmian also cites 0.25 dB as the G.657.A1 limit at 15 mm, 10 turns (search excerpt). — [Prysmian BendBright A1+](https://na.prysmian.com/sites/na.prysmian.com/files/media/products/TLS-DS-F-003A-1225_BendBright%20A1%2B%20Bend%20Insensitive%20Single-Mode%20Optical%20Fiber%20with%20Uncabled%20Attenuation.pdf)

**Splices**
- Fusion, core alignment: typically <0.05 dB. Cladding alignment: better than 0.1 dB. "In practice the splicing loss limit is set at 0.1dB". — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Building-entry fusion splice maximum 0.15 dB at 1550 nm, return loss >60 dB. Outlet splices (fusion or mechanical) design value maximum 0.25 dB. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Mechanical splice: typically <0.5 dB. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- FOA OSP specification: average 0.1 dB, reject at 0.2 dB. Lab splicer figures such as 0.02 dB do not represent field conditions. — [FOA deliverables](https://FoA.org/tech/ref/install/deliverables.html)
- **India, stricter contractual value [OPERATOR]:** an ITI Army-network tender penalises splices not averaging 0.05 dB per joint. — [ITI tender 2020](https://tenders.itiltd.in/assets_admin/dist/img/tendor/35675789piaofcnit.pdf)

**Connectors**
- Typical insertion loss 0.1–0.5 dB. IEC random-mate grades (mean/max for >97% of samples): A* 0.07/0.15, B 0.12/0.25, C 0.25/0.50, D 0.50/1.00. I reconstructed the row alignment from a garbled table extract, so verify against IEC 61753-1. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Handbook real-life example: a patch cord specified at 0.1 dB measured 0.2–0.3 dB in the field, because the specification was best-case. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- FOA OSP specification: average 0.3 dB, reject at 0.5 dB, reflectance better than −40 dB. — [FOA deliverables](https://FoA.org/tech/ref/install/deliverables.html)
- FOA recommends SC-APC throughout on splitters and short cables, but check transceiver requirements because some equipment specifies SC-PC. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)

**PLC splitters: insertion loss (dB)**

| Source | 1:2 | 1:4 | 1:8 | 1:16 | 1:32 | 1:64 |
|---|---|---|---|---|---|---|
| Ideal (10·log₁₀N, my arithmetic) | 3.0 | 6.0 | 9.0 | 12.0 | 15.1 | 18.1 |
| [Efo, standard grade max](https://efobasen.efo.no/API/Produktfiler/LastNed?id=1573112) | 3.6 | 7.0 | 10.2 | 13.3 | 16.5 | 20.0 |
| [Turksat-hosted datasheet max](https://www.turksat.com.tr/sites/default/files/onayli-urun/splitters_bare_and_mini_module_type_plc_splitters.pdf) | 3.8 | 7.1 | 10.4 | 13.5 | 17.0 | 20.5 |
| [Sanwa max](https://www.sanwa-tech.com/files/2023/10/PLC-SPLITTERS.pdf) | 4.0 | 7.4 | 10.7 | 13.7 | 16.9 | – |
| [SDE max](https://sde.network/wp-content/uploads/2021/10/Splitter.pdf) | 4.0 | 7.4 | 10.7 | 13.9 | 16.9 | 21.5 |
| [Omada "actual"](https://support.omadanetworks.com/in/document/112365/) | – | 7–8 | 10–11 | 13–14 | 17–18 | 20–21 |
| [FOA "typical" design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html) | 4 | 7 | 11 | 15 | 19 | – |

- The vendor rows are search excerpts. Whether connectors are included varies by datasheet.
- Excitel uses 10.5 dB for a 1:8 PLC. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)
- A vendor article warns that a poorly specified "1×32" at 18.5 dB rather than 17.5 dB can consume the repair margin. — [Glory Optics](https://www.gloryoptics.com/info/how-fiber-splitters-work-the-physics-the-los-103515634.html)

**FBT / unequal couplers**
- Monolithic FBT devices are available up to 1×4; higher ratios are built by cascading, with typically higher insertion loss and lower uniformity than planar. Planar splitters are symmetrical as standard devices. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Datasheet maxima, tap/through ports, Premium grade (search excerpts; port assignment inferred from theory): 50/50 about 3.5 ([datasheet](https://dtsheet.com/doc/1713488/download-pdf)); 40/60 about 4.7/2.7; 10/90 about 11.3/0.6; 5/95 about 15.0/0.4; 1/99 about 23.5/0.3 ([datasheet](https://dtsheet.com/doc/1713425/download-pdf)). A second maker lists 10/90 at 10.8 (P) or 12.0 (A) on the tap and 0.6 or 0.8 on the through port ([datasheet](https://dtsheet.com/doc/1713426/download-pdf)).
- Ideal split loss (tap/through, my arithmetic from −10·log₁₀(fraction); these exclude excess loss): 1/99 = 20.0/0.04; 5/95 = 13.0/0.22; 10/90 = 10.0/0.46; 20/80 = 7.0/0.97; 30/70 = 5.2/1.55; 40/60 = 4.0/2.2; 50/50 = 3.0/3.0.
- Rural tap designs: excess loss can reach 1 dB per tap, equated by FOA to about 2.5 km of fibre. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)

### Inferences
Suggested defaults, all operator-editable and labelled as assumptions:

| Item | Default | Basis |
|---|---|---|
| Fibre 1310 nm | 0.35 dB/km | between cabled spec 0.34 and planning 0.4 |
| Fibre 1490 nm | 0.25 dB/km (conservative 0.30) | between 0.21 datasheet and 0.30 planning |
| Fibre 1550 nm | 0.25 dB/km | FOA |
| Fusion splice | 0.1 dB | Handbook, FOA |
| Mechanical splice | 0.5 dB | Handbook upper value |
| Connector pair | 0.3 dB (reject 0.5) | FOA |
| PLC splitter | Efo-to-Turksat max row, or the installed unit's datasheet value | datasheets |

- Compute upstream and downstream separately. Upstream 1310 nm is the worse case per km, so a single dB/km value hides the limiting direction.
- Unequal couplers must store per-port loss. A single "loss" field on a splitter is a modelling error for FBT.
- Validation: flag a recorded splitter loss below the ideal value (physically impossible), and flag splice values above the reject threshold.

### Gaps
- The ITU-T G.652 and G.657 PDFs were not retrievable (the links I tried returned "Document Not Found"), so the normative G.652.D attenuation limits are not cited here. The 0.4/0.3 pair for G.657.A1 is Corning's reading.
- No single source gives a complete FBT table; 20/80 and 30/70 are ideal values only.
- A search excerpt showed a vendor 1×128 maximum of about 24.0 dB, but I could not pin it to a specific document. Ideal is 21.1 dB (arithmetic).
- No Indian (TEC) loss values were retrieved; Excitel and the tenders are operator-level only.

## Budgets: ODN classes, EPON, thresholds, reach and split

### Takeaway
G.984.2 B+ allows 13–28 dB and C+ allows 17–32 dB, and both limits matter: the minimum exists because of receiver overload. ONT Rx "good/warning/bad" bands are field conventions, not standards. Reach (20 km fibre, 60 km logical) and split (64 in the optics text, 128 on many OLT ports) are separate limits that are often conflated.

### Cited Findings
**GPON 2.488/1.244 Gbit/s, from [G.984.2 (08/2019)](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-G.984.2-201908-I!!PDF-E&type=items) [STD]**

| Parameter | B+ (Annex A, Tables A.1/A.2) | C+ (Appendix V, Tables V.1/V.3) |
|---|---|---|
| OLT launch | +1.5 to +5 dBm | +3 to +7 dBm |
| OLT Rx sensitivity | −28 dBm | −32 dBm (assumes FEC plus detector improvements such as SOA) |
| OLT overload | −8 dBm | −12 dBm |
| ONU launch | +0.5 to +5 dBm | +0.5 to +5 dBm |
| ONU Rx sensitivity | −27 dBm | −30 dBm (assumes FEC) |
| ONU overload | −8 dBm | −8 dBm |
| Optical path penalty | 0.5 dB each way | 1 dB down, 0.5 dB up |
| Loss range, both wavelengths | **13–28 dB** | **17–32 dB** |

Table A.1's layout was garbled in text extraction. I read the values in row order, and they agree with the G.9805 launch and minimum-loss values below and with the budgets by arithmetic.

- B+ is "industry best practice" in an annex and C+ is in an appendix, so they are formally not the main-body classes. The main-body ODN classes are A 5–20 dB, B 10–25 dB, C 15–30 dB, with differential optical path loss of 15 dB. — [G.984.2](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-G.984.2-201908-I!!PDF-E&type=items)
- Reach: maximum logical reach 60 km, differential logical reach 20 km, maximum fibre distance 20 km (10 km option). Logical reach is defined as independent of optical budget. Table V.3 lists 60 km maximum fibre length for reach-extended C+. — [G.984.2](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-G.984.2-201908-I!!PDF-E&type=items)
- Split: passive splitters with "16, 32 or 64 way split", restricted by path loss. — [G.984.2](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-G.984.2-201908-I!!PDF-E&type=items)
- **Conflict on split:** the Handbook says 28 dB, 20 km and 1:128 for B+, and 30 km by limiting split to 1:16 ([FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)). FOA lists 64 maximum splits for GPON ([FOA PON](https://www.thefoa.org/tech/ref/appln/FTTH-PON.html)). Huawei's H802GPFD board supports 128 ONTs per port ([Huawei board note](https://ftthlearning.blogspot.com/2017/10/appearance-and-description-of-huawei.html), search excerpt, source link unconfirmed) and a third-party ZTE C320 sheet lists 128 per GPON port ([ZTE C320 sheet](https://www.telecomate.com/wp-content/uploads/2026/04/ZTE-C320-OLT-Official-Technical-Overview-Datasheet.pdf), search excerpt).
- Corroboration: G.9805 lists B+ launch +1.5 to +5 and C+ launch +3 to +7, with minimum ODN loss of 13 and 17 dB (search excerpt). — [G.9805 on Scribd](https://www.scribd.com/document/686923547/T-REC-G-9805-202202-I-PDF-E)
- Vendor classes: Omada lists B+ with −28 sensitivity and C++ at +4.5 to +10, −33, 33 dB. C++ is not in the G.984.2 tables I read. — [Omada guide](https://support.omadanetworks.com/in/document/112365/)
- Vendor B+ SFP claiming 29.5 dB guaranteed budget — [Edgeoptic](https://edgeoptic.com/products/xpon/gpon-olt-class-b) (search excerpt). A datasheet budget above 28 dB is not the ITU class value.

**EPON (1.25 Gbit/s)**
- PX20: channel insertion loss 24 dB, maximum split 1:32. PX20+: 28 dB, 1:64. The vendor says new OLT procurement no longer includes PX20. — [FiberMall PON](https://www.fibermall.com/blog/passive-optical-network-pon.htm)
- FiberMall's garbled power table lists PX20 as 2, 7, −27, −1, 4, −24 with cost 26 dB, and PX20+ as 2.5, 7, −30, 0, 4, −27 with cost 29.5/30 dB. — [FiberMall PON](https://www.fibermall.com/blog/passive-optical-network-pon.htm)
- PX20++ OLT module: +5 to +8 dBm launch, −33 dBm sensitivity. This is vendor-defined and not an IEEE class. — [FiberMall PX20++](https://www.fibermall.com/file/datasheet/epon-olt-px20%2B%2B.pdf)
- Labelling is unreliable: one module labelled "PX20" shows −30 dBm OLT sensitivity, which matches PX20+ figures rather than PX20. — [Naddod PX20](https://resource.naddod.com/files/%20products-Optical%20Transceivers%20%26%20Cables/2023-09-26/sfp-ep43-px20-datasheet-008213.pdf)
- A blog claims about 32 dB total for PX20+, which conflicts with the 28 dB figure. — [Telecomate](https://www.telecomate.com/?p=2039272)
- FOA's PON table gives EPON 15–30 and 17–32 dB and maximum splits of 16, which does not match the figures above. — [FOA PON](https://www.thefoa.org/tech/ref/appln/FTTH-PON.html)
- Wavelengths: 1490 nm down, 1310 nm up. — [FiberMall PON](https://www.fibermall.com/blog/passive-optical-network-pon.htm)

**XG-PON / XGS-PON (brief)**
- G.987.2 loss classes: N1 14–29, N2 16–31, E1 18–33, E2 20–35 dB. — [G.987.2 on Scribd](https://www.scribd.com/document/685292560/T-REC-G-987-2-202302-I-PDF-E) (search excerpt)
- Omada XGS-PON: N1 +2 to +5, −29, 29 dB; N2 +4 to +7, −30, 31 dB; E1 +6 to +9, −30, 33 dB; 1577 nm down, 1270 nm up. — [Omada guide](https://support.omadanetworks.com/in/document/112365/)
- XGS-PON can overlay GPON through different wavelengths, and G.652/G.657 fibre supports these upgrades. — [FOA PON](https://www.thefoa.org/tech/ref/appln/FTTH-PON.html); [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)

**ONT Rx field thresholds (conventions only)**
- Huawei MA5833 guide: −8 to −27 dBm, with a −28 variant (search excerpt). — [Huawei MA5833 manual](https://www.manualslib.com/manual/1926002/Huawei-Ma5833.html?page=7)
- ZTE/Huawei field guide: −8 to −28 dBm; OLT thresholds are provided per ONT (search excerpt). — [Scribd Fiber Power](https://www.scribd.com/document/1069589607/Fiber-Power)
- Consumer guide: −8 to −22 good, −23 to −25 marginal, below −27 or LOS bad. [THUMB] — [SpeedtestHQ](https://speedtesthq.com/guides/diagnostics/read-fiber-light-levels)
- Tellabs: ONT downstream power should be above −25 dBm. It also quotes an upper limit of +9 dBm, which is inconsistent with the −8 overload for a B+/C+ ONU (search excerpt). — [Tellabs KB](https://kb.tellabs.com/gpon-optical-troubleshooter)
- **India [OPERATOR]:** Excitel's benchmark at the ONU is −22 dBm, with the installer checking 20–22 (sign omitted in the source) at the patch cord; link budget 28, OLT SFP 5–7 dBm. The document has internal unit inconsistencies. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)
- Margin: Omada recommends 3–5 dB. — [Omada guide](https://support.omadanetworks.com/in/document/112365/) FOA says link loss must lie between 13 and 28 dB, less your margin. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)
- FOA notes that too much power saturates the receiver and that attenuators may be used. — [FOA FTTH test](https://foa.org/tech/ref/appln/FTTH-test.html)

### Inferences
- **Why the minimums exist (arithmetic from the table):** B+ maximum launch 5 − 13 dB = −8 dBm, equal to overload. C+ ONU maximum launch 5 − 17 dB = −12 dBm, equal to the C+ OLT overload. So a validator must flag short, low-split links as too *little* loss, particularly with C+ optics on a short 1:8 link, not just too much.
- **Worked B+ check at 1310 nm:** 5 km × 0.35 = 1.75; 1:32 = 17; 6 splices × 0.1 = 0.6; 4 connectors × 0.3 = 1.2; total 20.55 dB. That leaves 7.45 dB, or 4.45 dB after a 3 dB margin. The same link at 1:64 (20.5 dB) totals 24.05 dB, leaving 3.95 dB, or 0.95 dB after margin. Extending that 1:64 link to 20 km adds 15 km × 0.35 = 5.25 dB, for 29.3 dB, which exceeds the 28 dB budget. Worst-case-spec analysis, not a guarantee.
- **EPON table reading (inference):** the arithmetic supports the column order OLT Tx min, max; OLT Rx; ONU Tx min, max; ONU Rx. PX20: 2 − (−24) = 26 down and −1 − (−27) = 26 up, matching the stated 26 dB. PX20+: 2.5 − (−27) = 29.5 and 0 − (−30) = 30, matching 29.5/30. So under this reading ONU sensitivity is −24 (PX20) and −27 (PX20+). The gap between 26 and 24 dB, or 29.5 and 28 dB, is the penalty allowance. Verify in IEEE 802.3 Clause 60.
- **Suggested default Rx bands, explicitly a tool convention and operator-editable (GPON B+):**

| Reading (dBm) | Status | Plain language |
|---|---|---|
| Above −8 | Bad, overload | Too much light. Check for missing splitter or wrong path; attenuator may be needed |
| −8 to −24 | Good | Normal operating range |
| −24 to −27 | Warning | Works, but little repair margin |
| Below −27, or LOS | Bad | Below the ITU B+ sensitivity |

- Use a stricter new-install acceptance value (−22 follows Excitel's benchmark) and let vendor thresholds override. The vendor OLT's configured thresholds should be the final authority.
- An ONT Rx reading validates 1490 nm downstream only. Upstream 1310 nm is checked by the OLT's per-ONT Rx reading, and the tool should store both.
- Store optics class per PON port, and do not infer it from the OLT model. Show ITU class and vendor budget separately, since labels such as PX20 and "29.5 dB B+" are not reliable.
- Treat split as two limits: the optical budget computed from loss, and `olt_port.max_onu` from the vendor (128 is commonly listed for GPON). 1:128 leaves about 28 − 24 = 4 dB for everything else on B+ using an approximately 24 dB splitter, an approximate figure from the unpinned excerpt noted above.
- Validate differential values on a PON: path-loss spread ≤15 dB and distance spread ≤20 km.

### Gaps
- IEEE 802.3 Clause 60 tables were not accessed; an [IEEE 2003 slide](https://www.ieee802.org/3/efm/public/mar03/optics/murphy_optics_1_0303.pdf) is pre-standard. PX20+ and PX20++ appear to be industry classes, but I found no authoritative statement of that.
- EPON port ONU limit (commonly assumed 64) was not directly confirmed; a Huawei source gives a 1:64 split ratio only. — [Huawei MA5680T material](https://www.normann-engineering.com/products/product_pdf/fttx_systems/huawei/MA5800%20Product%20Description%2003.pdf) (search excerpt; document attribution uncertain)
- G.9807.1 (XGS-PON) was not read. The sensitivities above are Omada's values.
- Huawei and ZTE default alarm thresholds were not found. No Indian regulator or TEC threshold was found.

## PON topology: vendor hierarchy, splitting architecture, nodes and path relationships

### Takeaway
OLT addressing has 2–5 levels depending on vendor, so hierarchy must be a flexible ordered path plus a raw vendor string rather than fixed chassis/slot/port columns. A real path is a chain of physical relationships from OLT port to ONT with specific core and port identity at every step. The product of split ratios, and not node names, determines what is valid; node names vary a great deal by operator.

### Cited Findings
**Vendor addressing (none confirmed in official vendor CLI references except where stated)**
- Huawei MA5800: `gpon 0/5/0 ont 1` reads as frame/slot/port plus ONT ID. Under an interface, `ont add 0 1 sn-auth` takes port then ONT ID. — [Splynx Huawei guide](https://splynx.com/4018/huawei-gpon-configuration/)
- ZTE C320: `gpon-olt_1/x/y` for the PON and `gpon-onu_1/x/y:n` for the ONU (search excerpt). — [SmartOLT ZTE](https://www.smartolt.com/zte-olt-initial-setup.html)
- ZTE caveat: on some firmware, SNMP shows ONU names as `onu:25` rather than `epon-1/2/3:25` until `mib-compatibility iftable v2` is set. — [UserSide ZTE polling](https://wiki.userside.eu/FAQ._ZTE_OLT_equipment_polling)
- Nokia ISAM: `1/1/1/2/33` as rack/shelf/slot/PON/ONT, from a training deck rather than official Nokia documentation. — [GPON basic configuration](https://api.sambuz.com/doc/gpon-basic-configuration-ppt-presentation-901929)
- BDCOM P3310 EPON: `ePON 0/1:5` style, slot/port:ONU. — [ixnfo BDCOM](https://ixnfo.com/?p=15865)
- VSOL: a CLI manual exists, but I could not confirm the syntax. — [VSOL GEPON CLI manual](https://xcombg.com/upload/vsol/GEPON%20OLT%20CLI%20User%20Manual_v2.0.pdf)
- Port density varies: MA5800 GPON ports by chassis are listed as 272/240/112/32 for X17/X15/X7/X2 (search excerpt). — [Huawei MA5800](https://e.huawei.com/gr/products/optical-access/ma5800)

**Centralised vs cascaded**
- Centralised splitting at CO or head end gives each subscriber a dedicated fibre and lets each OLT port serve 32 or 64 users anywhere in the area. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)
- Cascaded: ratios combine in any order with a product of no more than 32 in FOA's examples (2+16, 4+8, 2+4+4). 1:4 + 1:8 = 18 dB of splitter loss. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)
- Handbook example: 1:8 in buildings and 1:8 at node level. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- **India [OPERATOR]:** Excitel uses S1 PLC 1:8 in a closure or cassette connected to a PON port, then S2 blockless 1:8 in a box, serving up to 8 customers within about 100 m. That makes a 1:64 total. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)
- Reserve capacity [THUMB]: leave about 8 of 32 ports open when splitters are close to users, planning for about 24 active users. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)

**Node vocabulary**
- Handbook: POP, ODF, Fibre Distribution Point (FDP), Fibre Concentration Point (FCP), Fibre Flexibility Point (FFP), terminal boxes, distribution closures, Building Entry Point (BEP), Optical Telecommunications Outlet (OTO). — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- FOA uses FDH, with splitters in pedestals, manholes, handholes, aerial closures or building hubs. — [FOA FTTH design](https://www.thefoa.org/tech/ref/appln/FTTH-design.html)
- Excitel uses FMS (24/48 port), S1, S2 and INMS, and does not use FDT or FAT. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)
- BBNL's documents refer to OLT/FPOI, ONT/FTB, splitter and joint. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)
- ODF connection is either interconnection (patch cord from OLT port to the ODF port terminating the feeder) or cross-connection (mirror ODF bay, then patch cord to the feeder ODF). — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Excitel's design must record OLT→PON→splitter→port→customer mapping, naming, splitter and core details, and power budget. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)

### Inferences
- **OLT address model:** `olt.vendor`, `olt.address_format`, ordered components, `pon_port_raw` (the verbatim device string), plus `onu_id`. Never parse one vendor's format to another. Preserve the string so imports can reconcile against SNMP or CLI output.
- **Node model:** use functional type (`termination_frame`, `splice_closure`, `splitter_enclosure`, `access_terminal`, `premises`) with an operator alias field. FDT, FDH, FDP, FAT and NAP mean overlapping things; the operator's own labels should show in the interface.
- **A valid path is an ordered chain with no gaps:** OLT PON port → patch → ODF/FMS port → splice → cable core → (splices, closures) → splitter input → splitter output port → cores → terminal port → drop core → ONT. Every link should name a specific port or core at both ends.
- **Path validation rules:**
  - A core or port has only one continuation on each side.
  - Splitter outputs may not be cross-connected back into the same tree.
  - Each output carries one downstream path, and the product of ratios on a path must not exceed the configured limit.
  - Two OLT ports must never reach the same splitter tree unless it is a declared dual-input splitter (dual-input devices exist per the Handbook).
  - A cable existing between two points does not itself prove a logical path, since geometry is not connectivity.
- **Distinct records:** cable passing through a closure with no cut (express), and spliced cores. Otherwise mid-span closures appear to break all cores.

### Gaps
- Official Huawei, ZTE, Nokia, VSOL and BDCOM CLI references were not read. Formats come from third-party guides, and details vary by firmware. Sample a real device export before finalising the import.
- FDT/FAT/NAP definitions from an Indian standard were not found. I found no source establishing a common Indian vocabulary, so what is "typical" there remains unverified.
- No market data on OLT vendor share among small Indian ISPs.

## Common mapping mistakes and OTDR confirmation

### Takeaway
Documentation errors are widely reported, and drawn length is structurally different from fibre length. An OTDR reports fibre distance, which runs longer than sheath length (typically 1–3%), which in turn differs from the mapped route because of slack and detours. A tool should keep drawn, sheath and optical lengths as separate fields and should never treat one as confirming another without conversion.

### Cited Findings
**Scale**
- In a 2026 survey, only 13% of operators said their network data is largely accurate, 100% reported business impact from inaccurate physical network data, and 71% cited project and activation delays. Survey findings as reported by the Fiber Broadband Association from a survey sponsor; treat as indicative. — [Fiber Broadband Association](https://fiberbroadband.org/2026/10/08/only-13-of-telecom-operators-say-their-network-data-is-largely-accurate-putting-service-activations-and-ma-at-risk/)

**How records go wrong**
- Link length may not match route distance because excess is coiled in pits or because of undocumented detours; minor route discrepancies "can cause havoc during precise fault location". — [STL fault procedure](https://stl.tech/wp-content/uploads/2023/04/Fault_Location_Detection_Procedure-_New_Final.pdf)
- Patch changes made in the field must be stored in the documentation system, and mistakes "will be difficult to correct at a later date". — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Build deviation from design can reach 20% on Excitel's accounts, and it requires splitter data and deviations to be sent back for INMS entry. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)
- Mixed colour standards appear when a replacement cable with a different scheme is spliced in during a fault repair. — [FOA cross reference](https://www.foa.org/tech/ref/install/Color%20Codes%20Cross%20Reference.pdf)
- Audit practice: open handholes and splice cases, compare against records, and redline. Capture photos and sequential footage marks. — [NetworkConnex audit](https://networkconnex.com/?p=1235); [NetworkConnex documentation](https://www.networkconnex.com/?p=2896)
- Depth recorded by design rather than as-built can be nearly a metre out (one example, not a rate). — [EditFast](https://editfast.com/editing-services/telecommunications-and-infrastructure/fibre-and-network-infrastructure/)

**Length arithmetic**
- "The OTDR measures the length of the fiber, not the cable." Most cables have 1–2% excess fibre, less on ribbon. — [FOA OTDR FAQ](https://www.foa.org/tech/ref/testing/OTDR/OTDR-FAQS.html)
- Corning: stranded loose tube is typically 2–3%, central tube zero to a fraction of 1% (search excerpt). — [Corning AEN142](https://www.corning.com/catalog/coc/documents/application-engineering-notes/AEN142.pdf)
- A published paper notes the ratio can reach about 1.04 in stranded loose tube (search excerpt). — [Borzycki, JTiT 2021](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-a180ee63-5e05-4dd9-ad69-2fa1502e965d/c/JTiT_2021_4_Borzycki.pdf)
- EXFO OTDRs have a helix factor setting that makes the distance axis match cable length (search excerpt). — [EXFO manual](https://www.manualsdir.com/manuals/736486/exfo-otdr-2.html?page=32)
- Sterlite method: correction = sheath distance (the difference of metre marks at both ends) ÷ measured fibre length, then fault sheath length = fibre length × correction. It considers length markers the most accurate measure. Markers are about ±0.5% accurate from the factory. It states OTDR location uncertainty of "about ±1%, eg 20 meters per Km"; note that its own example is inconsistent, as 1% of 1 km is 10 m. — [STL fault procedure](https://stl.tech/wp-content/uploads/2023/04/Fault_Location_Detection_Procedure-_New_Final.pdf)
- FOA worked example: 10 km cable reads 6500 m and 4000 m from opposite ends (10,500 m total), correction 0.952, placing a break at about 6190 and 3810 m. — [FOA OTDR FAQ](https://www.foa.org/tech/ref/testing/OTDR/OTDR-FAQS.html)

**OTDR use on PON**
- Test from the subscriber toward the CO. From the OLT side the OTDR adds backscatter from all branches and the trace is hard to read. — [FOA FTTH test](https://foa.org/tech/ref/appln/FTTH-test.html)
- A 1:32 splitter is about 17.5 dB and consumes dynamic range, so plan test points at the FDH (search excerpt). — [FOA PON testing](https://www.thefoa.org/tech/ref/install/Testing%20FTTH%20PON%20network.html)
- Cascades make setup hard because range needs long pulses and splitter resolution needs short ones; test points around splitters help. — [FOA FTTH test](https://foa.org/tech/ref/appln/FTTH-test.html)
- In-service testing uses a filtered 1625 or 1650 nm OTDR, which is more sensitive to bends. 1310/1550 nm is valuable during construction. — [EXFO PON note](https://www.exfo.com/contentassets/d407e533bf304cf8a8d635f389a1bc3a/exfo_anote201_otdr-pon-testing_en.pdf); [FOA PON testing](https://www.thefoa.org/tech/ref/install/Testing%20FTTH%20PON%20network.html)
- 1490 nm OTDR testing adds little over 1550 nm (search excerpts, vendor views). — [Viavi](https://www.viavisolutions.com/ja-jp/node/10468); [Normann poster](https://normann-engineering.com/support/posters/Understanding%20Passive%20Optical%20Network%20(PON)%20Testing%20(pdf)%20(1).PDF)
- Launch cable of 500–1000 m for singlemode. — [FOA OTDR FAQ](https://www.foa.org/tech/ref/testing/OTDR/OTDR-FAQS.html)
- Bidirectional testing removes backscatter error but not real directional splice difference; MFD variation can cause 0.20–0.25 dB directional difference. — [FOA deliverables](https://FoA.org/tech/ref/install/deliverables.html)
- Mixed fibre types: use bidirectional OTDR to determine correct splice loss. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- VFL is used to confirm fibres are connected per documented diagrams; passive devices must be tested and documented; deliverables include GIS data on the cable and every component. — [FOA deliverables](https://FoA.org/tech/ref/install/deliverables.html)
- Save OTDR traces and add OTDR-measured lengths to diagrams. — [FOA FTTH test](https://foa.org/tech/ref/appln/FTTH-test.html)

**India as-built requirement [OPERATOR]**
- BBNL requires PON OTDR readings at each of OLT, splitter, joint and ONT, along with the coil length on each side. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)
- BBNL as-built drawings have two parts: an overall route (OLT/FPOI to ONT/FTB) and detail sheets in 200–250 m grids, each uniquely numbered, with three-point references for every chamber. They record OFC depth, terminated and spare fibre counts, loop, cable make and size, logical diagram, OTDR and power meter readings, and per-fibre results, along with installation method. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)
- ITI's Army tender requires as-built drawings and GIS route maps in KMZ/KML, plus OTDR traces showing losses. — [ITI tender 2020](https://tenders.itiltd.in/assets_admin/dist/img/tendor/35675789piaofcnit.pdf)
- Excitel captures survey in KML/KMZ, designs in SHP with PDF sign-off, freezes versions, and samples ONU power for acceptance. — [Excitel rollout doc](https://www.slideshare.net/MritunjayKumar114/excitel-fiber-roll-out-doc-17april19)

### Inferences
**Length model.** Keep four fields:
- `drawn_length_m` (geometry)
- `sheath_length_m` (metre-mark difference, the best physical measure)
- `optical_length_m` (OTDR)
- `slack_m` (sum of recorded loops)

Expected relationship: `sheath ≈ drawn + slack` and `optical ≈ sheath × (1 + excess)`.

**Reconciliation warnings (thresholds are my proposals, not standards):**
- Optical shorter than sheath by more than about 1%: likely a wrong core, a wrong cable, or an unrecorded break.
- Optical greater than sheath by more than about 5%: unrecorded slack or a route detour (allowing for 1.04 ratio and about 0.5–1% measurement uncertainty).
- A single end-to-end drawn length with no slack entries on a long aerial route: slack not captured.

**Mistakes to catch:**

| Mistake | How it shows up | Check |
|---|---|---|
| Wrong core recorded | Two records claim one core; ONT light on an "unused" core | One-occupant rule on each core |
| Splice mismatch from colour assumption | Cores numbered differently across a closure, with no record of a scheme change | Require scheme per cable |
| Slack omitted | OTDR longer than map | Length reconciliation |
| Drawn vs measured confusion | Loss budget low, fault location wrong | Separate fields, label source |
| Unrecorded patch at ODF | ONT on a different PON than recorded | Compare OLT export against mapped path |
| Splitter ratio wrong or unrecorded | Rx differs from predicted by about 3 dB per doubling | Predicted vs measured Rx |
| Splice value recorded from one direction | Apparent gainer or high loss | Mark uni/bidirectional |
| Design treated as as-built | No field evidence | `status: planned / built / verified` |

- **Confidence field:** record per asset whether verified by OTDR, VFL, power reading, physical inspection, or merely imported. Colour map confidence so that users do not trust unverified data.
- **Predicted vs measured Rx is the cheapest whole-path check:** OLT launch − computed loss vs ONT Rx. A persistent gap of more than about 3 dB suggests a dirty connector, bend, wrong path or wrong splitter ratio. That threshold is my heuristic.
- **Distance alone does not confirm identity.** OTDR gives distance and events, while VFL, continuity or light-level checks confirm which fibre. Use OTDR event positions against recorded closures.

### Gaps
- No standard procedure was found for reconciling splice-level mismatches, and no quantified Indian error rates.
- The Schneider Electric Fiber Manager "cable length and glass length" page, a useful precedent for GIS modelling, returned HTTP 403 and was not read. — [Schneider page](https://productinfo.se.com/arcfmsolution/fiber-xi-using/Fiber%20XI%20Using/English/Fiber%20Manager%20XI%20Using%20Guide%20(bookmap)_0000621839.xml/$/FiberCableLengthandGlassLengthFXICPT_0000994672)
- The excess-fibre value for specific Indian cables was not found on datasheets I read; calibrate against metre marks.

## Fiber slack / loop recommendations

### Takeaway
Slack is documented but there is no single standard length. Sources give 3–5 m per joint as a route allowance, about 20 m loops at chambers, 10 m at aerial splice locations in Indian instructions, and 40 m in one Indian pull-through specification. I could not confirm any "X m per km" rule, including the often-repeated 15 m/km, so slack should be an operator setting with recorded actuals.

### Cited Findings
| Context | Value | Status | Source |
|---|---|---|---|
| Route length allowance per joint | "typically 3-5m per joint" | Industry handbook, Europe | [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf) |
| Spare/slack loops at chambers | "typically 20m", enabling later mid-span joints | Industry handbook | [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf) |
| Aerial (ADSS) at splice location | About 10 m for coiling and jointing | Indian engineering instruction, BBNL | [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf) |
| Aerial at splice location | 10 m | Same instruction text, power utility tender | [OPTCL EI](https://www.optcl.co.in/writereaddata/Tender/212218042227SectionVIIEngineeringInstruction_07032018.pdf) |
| Aerial at splice location | 10 m | ITI Army tender | [ITI tender 2020](https://tenders.itiltd.in/assets_admin/dist/img/tendor/35675789piaofcnit.pdf) |
| Underground pull-through chamber | "at least 40 Mtrs" | One project spec (Army network), not a general norm | [ITI tender 2020](https://tenders.itiltd.in/assets_admin/dist/img/tendor/35675789piaofcnit.pdf) |
| Customer drop at SFU demarc | 25–50 ft (about 8–15 m); pre-connectorised flat drop 50–100 ft (about 15–30 m) | Vendor guidance, US | [TII deployment guidance](https://tiitech.com/?p=30845) |

- BBNL aerial: "Cable loops are to be provided for future maintenance purposes at regular spacing", on a fixture maintaining bend radius, with no interval stated. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)
- BBNL underground: a manhole at every cable pulling location houses the OF cable loop, and joint chambers house extra length needed for later faults. Length is not stated in the extracted passages. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)
- Handbook: "maintenance lengths should be available at all times" in duct, because cables get dug up; on-pole slack must be stored for access or closure installation; accurate surveys minimise slack with pre-connectorised drops. — [FTTH Handbook 2017](https://www.plumettaz.com/0/EE8FCFC4B728F572C1258409002593E1/$FILE/FTTH%20Handbook_2017_V8_FINAL.pdf)
- Layout: loops must respect minimum bend radius and be removable without disturbing others. [THUMB] — [Fiber Done Right](https://fiber-done-right.beehiiv.com/p/slack-length-vs-slack-layout)
- Bend limit example: Sterlite's cable 20D (for 12.5 mm cable, 250 mm). — [STL/Bharti spec](https://stl.tech/wp-content/uploads/2024/08/Bharti-48F-and-96F-NOVA-SSA-Specs2.4mm.pdf) A BSNL training deck is reported to state 24× diameter (search excerpt). — [BSNL deck on Scribd](https://www.scribd.com/doc/155304779/OFC-Power-Point)
- Records: BBNL's as-built specification records loop and requires coil length at each calibration point. — [BBNL/ITI tender](https://tenders.itiltd.in/assets_admin/dist/img/tendor/41713018NITPIABBNL.pdf)

### Inferences
- **Record, then default.** Store slack as point assets (location, length, parent cable, source: measured or assumed), and include them in sheath and loss length.
- **Suggested configurable defaults for India:** 10 m at aerial splice locations (BBNL/OPTCL text), 20 m at chamber loops (Handbook), and 5 m joint allowance on top (Handbook, upper value). Label these as defaults, not requirements.
- **Plain-language guidance:** "Leave spare cable where you may need to rejoin later. Record how much: if the map doesn't show it, fault distances will be wrong."
- **Impact is small on loss and large on location:** 20 m at 0.35 dB/km = 0.007 dB, but each uncounted 20 m loop shifts a fault location by up to 20 m. A route with several uncounted loops can therefore misplace a fault by tens of metres.
- **Validation:** warn when recorded loop diameter would violate minimum bend radius if diameter is captured; warn if a closure has no slack recorded on an aerial route.

### Gaps
- **No per-km rule confirmed.** I found no source for "15 m per km", or a stated Indian interval for aerial loops or underground coils. BSNL and DoT underground engineering instructions likely hold exact values, but the BSNL tender hosts (odisha, chennai, jharkhand) did not resolve or connect from this environment and the Scribd copies were not read.
- IEC 62901 (drop cables) was only seen as a table-of-contents preview. — [IEC 62901 preview](https://www.vde-verlag.de/iec-normen/preview-pdf/info_iec62901{ed1.0}en.pdf)
- The values above come from project or tender documents dated up to 2020–2024 and a 2017 handbook. A 2021 Handbook edition exists but I did not read it. — [FTTH Handbook 2021](https://ftthcouncil.eu/resources/all-publications-and-assets/ftth-handbook-2021-ftth-council-europe)
