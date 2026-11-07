# India permissions and safety

**This is dated reference data, not legal advice.** Show it with a source and date. Do not build countdowns or fee logic on it until someone has read the gazette. Sources: `reports/ISP and cable TV mapping rules.md`.

## Telecommunications (Right of Way) Rules, 2024

In effect from 1 January 2025. Read from DoT's own slides; gazette GSR 576(E) was **not** read.

| Item | Value |
|---|---|
| Application fee | ₹1,000 per km, one time, underground and overground |
| Establishing a pole | NIL |
| Telecom line on street furniture | ₹100 per item per year |
| Other charges | DoT's slides bar public entities from levying other charges |
| Deemed permission | 67 days in DoT slides; a law firm summary says 45. DoT treats 45 as the intent-to-reject point. Unresolved |
| Rule 13 | Up-to-date digital as-built records of **underground** network, shared on demand through the portal |
| Rule 18 | On the owner's notice: 30 days to plan, 90 days to complete removal |
| Rule 19 | Network details to people about to dig: 24 hours in an emergency, 7 days otherwise |

So duct route, depth, count and as-built geometry are first-class data, and a quick "what lies here" export is valuable. The wording covers underground networks, so do not claim an equal duty for aerial plant.

## Electric poles

This is where small ISPs and LCOs face the most conflict, so record owner and permission on each pole.

- DoT's 2022 table: annual rent from ₹50 (rural Odisha) to ₹1,500 (Assam); Delhi ₹20,000 per pole for 5 years, which is ₹4,000 a year
- KSEB, rates dated 2021: ₹300 urban, ₹145 panchayat, rising 3% a year (Excerpt)
- **No BESCOM or Karnataka rate was found.** Ask BESCOM in writing
- An accurate pole count is money: at an illustrative ₹300, 1,000 poles is ₹3 lakh a year
- BESCOM's removal drives followed a pole collapse that injured a student, with a July 2024 deadline and providers held liable (Excerpts). Operators said they had paid and held permission, while BBMP said it gives none

Dated, geotagged photos with a permission reference may help an operator during a removal drive. That benefit is an inference, not a sourced outcome.

**Unresolved, so never present a rate as the rule:** whether ₹100 overrides state DISCOM rates, whether private DISCOMs are bound, and whether MIB-registered LCOs count as "authorised". Use a per-owner rate table and get legal confirmation.

## Trench depth

1.65 m depth and 0.45 m width repeat in NH permission files, but no national DoT, TEC or BSNL norm was found, and depth seems to be set per permission. Do not hard-code it. Store observed depth beside permit depth and compare those.

## Government-linked formats

DoT GatiShakti material reportedly asks IP-I holders for KML or shapefile with operator, backhaul source, install date and core counts (Excerpt). ITI tenders require KMZ/KML route maps. BBNL as-builts use 200–250 m numbered grid sheets recording depth, spare fibers and three-point chamber references, a useful export template.

## Safety

**Needs a qualified safety reviewer before it reaches users.** No Indian field-safety guide was found, and the CEA 2023 safety regulations were not read.

Proposed app wording:

- Mapping never requires climbing or touching a pole
- Treat every wire, stay and metal pole as live
- Do not survey poles in rain or lightning
- Do not raise rods or ladders near wires
- Report a leaning, sparking or burning pole to the electricity office
- Do not stand in traffic for a photo
- Do not use the phone while riding

"Hazard seen" should be a one-tap report. Never reward moving closer for a better photo or GPS fix.

**Clearances:** FOA's core rule is that telecom cable stays below power, with clearance held at mid-span where sag reduces it. The only Indian figures found are a Karnataka circular reported in 2004: 3.05 m above ground along roads, 5.8 m across roads, 1.2 m below LT, 1.8 m below 11 kV, tapping at least 2 m from poles. Over 20 years old, so show them as state-and-date reference pointing to current DISCOM conditions. Never present them as safe limits.
