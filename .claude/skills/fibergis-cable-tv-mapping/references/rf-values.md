# RF and HFC reference values

Grades: **Datasheet**, **Listing** (seller listing), **Excerpt** (search extract only), **Rule of thumb**, **Calculated**. Only the unit conversion is a true constant. Keep everything else in editable, switchable profiles. Sources: `reports/ISP and cable TV mapping rules.md`.

## Units

- dBµV = dBmV + 60 (constant)
- At 75 Ω: dBµV = dBm + 108.75, dBm = dBmV − 48.75 (Calculated)
- Coax loss scales roughly with √frequency, so quadrupling frequency roughly doubles dB. Good for interpolation, not final figures

## Wavelengths

G/GE-PON 1490 down, 1310 up. 10G PON 1577 down, 1270 up. Video 1550. RFoG 1550 down, 1610 up (Excerpt, vendor sheets). RFoG has beat-interference risk when R-ONUs transmit together.

## Levels

| Item | Values | Grade |
|---|---|---|
| Node or receiver input | C-Data −18 to +3 dBm, 80 dBµV at −8; Softel −20 to −1, 78±2 at −10; C-COR −20 to +2, ≥83; Tejasri passive −15 to +2, ≥70 at −1 | Excerpts and listings; catalogue per model |
| Optical amplifier | Band 1545–1565 nm; input −10 to +10 dBm (economic −3 to +10); port output 17–23 dBm; noise figure ≤6 dB; EDFA below 27 dBm total, EYDFA 27–41 | One vendor (C-COR) |
| WDM EDFA | OLT pass loss ≤0.8 dB; LC/UPC from OLT, LC/APC to ONTs | One vendor |
| Example amplifier | Teleste CX3: 43 dB forward, 28 dB return gain, Umax 110 dBµV, 20 dB test points, 28–65 VAC remote or 180–255 VAC local. Diplex 65/85, 85/105 or 204/258 MHz by plug-in | Datasheet |

**Not found:** typical amplifier operating levels, tilt plans, an Indian level plan, tap-versus-distance tables, an authoritative cascade limit (one dated paper: two trunks, a bridger, three extenders; a glossary: 3–5).

## Passive losses

| Item | Values | Grade |
|---|---|---|
| 2-way splitter | Plan 4 dB (3.5–3.8 low band, up to 5.5 top) | Rule of thumb |
| 4-way splitter | 7.5–8 dB | Rule of thumb |
| 8-way splitter | 11–12 dB | Rule of thumb |
| 3-way splitter | Can be unbalanced, 3.5 / 7.0 dB | Datasheet |

## Coax loss per 100 m

| Cable | 750 MHz | 1002 MHz | Grade |
|---|---|---|---|
| P3 500 | 7.09 | 8.32 | Excerpt; source PDF unconfirmed |
| P3 625 | 5.84 | 6.92 | Excerpt |
| RG11 | 11.90 max | not found | Datasheet |
| RG6 | about 17.5 | not found | Low confidence |

## Subscriber levels

| Item | Values | Grade |
|---|---|---|
| Indian STB input | Min 60 dBµV to 300 MHz, 57 above; max 80 under 20 channels, 77 over; 47–862 MHz | 2003 summary of paywalled BIS text, pre-digitisation. Another report says 47 dBµV. Editable |
| DOCSIS 3.1 downstream | Min CNR 41 / 34 / 27 / 21 dB for 4096 / 1024 / 256 / 64 QAM; OFDM average above −6 dBmV; MER above 36 dB | Field poster, not CableLabs text |
| DOCSIS legacy | SNR 64-QAM ≥23.5, 256-QAM ≥30; upstream transmit 40–50 dBmV | Rules of thumb; upstream maximum drops with bonding, so tie it to channel count |

## AC power

60 or 90 V AC on coax (trade papers, US-centred). Example criteria: 50 VAC minimum at a node, 14 A supply load. One 60 VAC case had almost 11 A on a leg. Indian powering was not documented.

## Test cases for a calculator

These test the arithmetic. They are not design guidance, because they rest on dated or listing-grade figures.

- Passive node at ≥70 dBµV (at −1 dBm optical input), minimum 57: about 13 dB spare, which is one 4-way plus a short drop
- 80 dBµV receiver, 8-way at 11.5 dB, 30 m RG6 at 750 MHz (5.25 dB): about 63 dBµV, inside the 57–77 window
- Sanity check: a reading cannot exceed the upstream level minus passive loss. 72 dBµV through a 4-way, then 72 dBµV at the customer, means a wrong unit, a rating instead of a reading, a test point, or the meter being upstream

## Mapping tool patterns

Bentley Coax routes on poles, pedestals, manholes and duct with live signal and tap sizing (Excerpt). Schneider places nodes and taps on strand points from catalogue defaults, with amplifier profiles (Excerpt). No coax model surfaced for VETRO or 3-GIS, though that does not prove they lack one.
