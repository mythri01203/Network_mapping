# HFC / Cable TV Network Structure and Engineering for Mapping and Inventory Software (India focus)

Researched 2026-11-07. Source strength tags used below:
- [Datasheet] = I read the vendor document text directly.
- [Excerpt] = seen only in a search-result excerpt; the page was not opened or the fetch failed. Check before using as a hard rule.
- [Listing] = marketplace seller claim with no test conditions.
- [RoT] = rule of thumb.
- [Calc] = my arithmetic.

## What are the components and the signal path (forward and return)?

### Takeaway
Classic HFC runs headend/hub -> fiber -> optical node -> coax trunk with amplifiers -> feeder with taps and line extenders -> drop -> STB or modem, with a return path running the opposite way on the same coax. A mapping tool must treat it as a directional RF tree that also carries AC power, where each element has a gain or loss that varies with frequency.

### Cited Findings
**Overall structure**
- A fiber network runs from the master headend, sometimes through regional headends, to a neighbourhood hubsite and then to a node serving about 25 to 2000 homes — [Wikipedia: Hybrid fiber-coaxial](https://kaweah.freedombox.rocks/kiwix/wikipedia_en_all_maxi_2023-10/Hybrid_fiber-coax) [Excerpt, secondary]
- The optical node converts optical to electrical downstream and electrical to optical upstream — [Wikipedia: Hybrid fiber-coaxial](https://kaweah.freedombox.rocks/kiwix/wikipedia_en_all_maxi_2023-10/Hybrid_fiber-coax) [Excerpt, secondary]
- Trunk cable is made of coax segments separated by trunk and bridger amplifiers. Bridgers form distribution points that feed feeder cables, and feeders contain taps and a smaller number of line extender amplifiers — [US patents on HFC taps, e.g. 10950956](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10950956) [Excerpt]; [IEEE 802.3 EPoC slide deck](https://grouper.ieee.org/groups/802/3/epoc/public/mar12/schmitt_01_0312.pdf) [Excerpt]
- One teaching source says coax trunk needs an amplifier about every 1 km — [UBC lecture notes](https://people.ece.ubc.ca/~edc/4550.jan2014/lectures/lec4.pdf) [Excerpt, RoT; attribution within that search result set not fully confirmed]

**Optics**
- EDFA/EYDFA amplifying band is 1545 to 1565 nm. C-COR positions its non-WDM models for "high branching networks to replace a lot of 1310nm directly modulated optical transmitters in wide coverage short distance networks" — [C-COR 1550 nm EYDFA datasheet, June 2021](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]
- C-COR recommends EYDFA over EDFA when total optical power exceeds EDFA capability: use EDFA below 27 dBm total, EYDFA for 27 to 41 dBm — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]

**RF actives**
- A current small distribution amplifier, Teleste CX3, has 85 to 1218 MHz downstream, 5 to 204 MHz upstream, swappable diplex filters (65/85, 85/105, 204/258 MHz), and swappable output modules: minimum loss, 2-way splitter, 8 dB tap, 14 dB tap — [Teleste CX3 datasheet, 2026](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf) [Datasheet]
- So one amplifier can be configured with 1 or 2 outputs ("Configurable for one or two outputs when a splitter / tap module is used") — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf) [Datasheet]

**Coax and powering**
- Trunk coax carries AC, inserted by a power supply and power inserter at about 60 or 90 V, so nodes and amplifiers need no separate external power — [Wikipedia: Hybrid fiber-coaxial](https://kaweah.freedombox.rocks/kiwix/wikipedia_en_all_maxi_2023-10/Hybrid_fiber-coax) [Excerpt, secondary]; [NCTA 1995 powering paper](https://www.nctatechnicalpapers.com/Paper/1995/1995-hybrid-fffier-coax-network-powering-issues/download) [Excerpt]
- Taps typically block AC from the coax line toward the subscriber — [US patent 5909154, Broadband signal tap with continuity bridge](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5909154) [Excerpt]

**RFoG (the fiber-deep variant)**
- RFoG replaces the coax with a single-fiber passive optical network. The R-ONU, or fiber micro-node, terminates the fiber at the home — [Wikipedia: RFoG](https://en.wikipedia.org/wiki/Radio_frequency_over_glass) [Excerpt, secondary]
- Common wavelengths are 1550 nm downstream and 1610 nm upstream, with return splits of 5-42, 5-65 or 5-85 MHz. Some R-ONUs use 1310 nm return — [CommScope RFoG R-ONU datasheet](https://fr.commscope.com/globalassets/digizuite/61667-cp85x7u-8u.pdf) [Excerpt]; [ARRIS Aurora RFoG micronode](https://www.tvcinc.com/shared-downloads/4802435711-arris-aurora-rfog-micronode-ds.pdf) [Excerpt]
- Early deployments used 1590 nm return, and the RFoG standard is SCTE 174 — [Wikipedia: RFoG](https://en.wikipedia.org/wiki/Radio_frequency_over_glass) [Excerpt, secondary]
- Upstream can degrade when several R-ONUs transmit at once (optical beat interference). "OBI-free" designs let 8 or 16 R-ONUs share a receiver — [CommScope MDU R-ONU](https://fr.commscope.com/globalassets/digizuite/61667-cp85x7u-8u.pdf) [Excerpt]
- Conflict: one mirror of the RFoG article describes a 1490 nm downstream and 1310 nm return arrangement for sharing with PON, while vendor sheets use 1550/1610 nm — [Cavacopedia mirror](https://cavac.at/cavacopedia/Radio%20frequency%20over%20glass) vs [CommScope](https://fr.commscope.com/globalassets/digizuite/61665-cp80x5-8u.pdf) [Excerpt]. Trust the vendor sheets.

### Inferences
- Suggested element types for a mapping tool: `Headend/Hub`, `CMTS/CCAP`, `OpticalTx(1310|1550)`, `OpticalAmp(EDFA|EYDFA, WDM yes/no)`, `FiberSplitter`, `WDM`, `OpticalNode/MiniNode(active|passive)`, `R-ONU`, `TrunkAmp`, `BridgerAmp`, `LineExtender`, `Tap`, `Splitter`, `DirectionalCoupler`, `PowerInserter`, `PowerSupply`, `Terminator`, `CoaxSpan(grade,length)`, `Drop`, `GroundBlock`, `STB`, `CableModem`, `CATV-ONU`.
- Amplifiers should be modelled as configurable objects, because the CX3 shows that output count, output coupling and return split depend on plug-ins, not just the model.
- A single path of the form optical input -> RF output -> span loss -> tap value -> drop loss can be computed, so forward-level prediction is possible once span lengths and grades are recorded.

### Gaps
- I did not retrieve a primary CMTS/CCAP or DAA (remote PHY) source, and no 1310 nm transmitter datasheet.
- Not verified this session (background knowledge, confirm before treating as fact):
  - Trunk amps prioritise low noise and cascade, while bridger and LE outputs run hotter to feed taps.
  - Return signals pass through the same amps via diplex filters in the reverse direction.
  - Feeder ends need a 75 ohm termination or a terminating tap.
  - CCAP merges CMTS and edge-QAM functions.

## How do Indian MSOs and LCOs actually build networks?

### Takeaway
Available evidence points to a 1550 nm EDFA tree with low-cost mini or passive nodes, and WDM EDFAs that combine GEPON and CATV on one fiber. This evidence comes almost entirely from vendor listings. I found no independent or regulatory engineering description of Indian LCO plant, so treat the "Indian practice" picture as probable, not proven.

### Cited Findings
**Regulatory context (solid)**
- The distributor merges broadcaster channels, encrypts the combined signal and retransmits it, directly or through an LCO, to the customer — [TRAI draft, October 2026](https://www.trai.gov.in/sites/default/files/2026-10/Draft_CP_09102026.pdf.pdf) [Excerpt]. The document's title page reads "Draft Telecommunication (Broadcasting & Cable) Services DRM Based Digital Addressable Systems Audit Manual", dated 9 October 2026.
- DPOs must have their DAS audited for the preceding financial year before 30 September 2026, and must hold valid MIB DAS permission plus BIS certificates for every STB make and model deployed — [BECIL presentation, August 2026](https://trai.gov.in/sites/default/files/2026-08/BECIL_05082026.pdf) [Excerpt]
- Cable STBs are tied to IS-15245 of 2002 or IS-16128 of 2013. DTH boxes use IS 15377 or IS 15954, so IS 15377 is not the cable standard — [TRAI addressable-systems regulation text via Indian Kanoon](https://future.indiankanoon.org/doc/98820690/) [Excerpt]
- TRAI's audit framework concentrates on CAS, SMS, fingerprinting and STB compliance under Schedule III. I found no RF plant level requirements in the excerpts — [TRAI Audit Manual, March 2026](https://trai.gov.in/sites/default/files/2026-03/Audit_Manual_10032026_0.pdf) [Excerpt]

**Indian vendor evidence (listings)**
- Hyderabad seller Tejasri Fiber NXT lists a 4-port "Optical Passive Node" (model TRH-1206), input -15 to +2 dBm, output ≥70 dBuV at -1 dBm. It also lists single-output WDM passive nodes at 45-1000 MHz, input -14 to +2 dBm, and a "CATV Micro FTTH Node" at 40-1006 MHz with 110-240 V AC supply. Listed prices run from about ₹95 to ₹450 — [Tejasri FTTH nodes, IndiaMART](https://m.indiamart.com/tejasrifibernxttechnology/ftth-nodes.html) [Listing]
- The same seller lists WDM PON EDFAs and CATV EDFAs with 4/8/16/32 outputs at 19/22 dBm — [Tejasri profile, IndiaMART](https://m.indiamart.com/tejasrifibernxttechnology/profile.html) [Listing, Excerpt]

**GEPON + CATV overlay mechanics**
- WDM plan for EYDFA models: G/GE PON 1490 nm down and 1310 nm up, 10G PON 1577 nm down and 1270 nm up, video 1550 nm — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]
- These units have one or two video inputs, up to 64 OLT PON input ports (LC/UPC) and up to 64 COM output ports toward ONTs (LC/APC). OLT pass loss is ≤0.8 dB, and CATV-to-OLT isolation is 40 dB — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]
- A GEPON ONU with CATV lists Tx 1310 nm, Rx 1490 nm and CATV Rx 1550 nm on one fiber. (The excerpt says "CATV Tx1550nm"; I read this as a typo for the receive direction.) — [Fiberopticom listing](https://www.fiberopticom.com/showroom/ftth-fiber-optic-network-router-1ge-1fe-wifi-catv-dual-pon-port-gepon-gpon-epon-onu.html) [Listing, Excerpt]
- Mini receivers exist with WDM built in — [Airlive GPON ONU-CATV](https://airlive.com/data/download/file/Airlive%20GPON%20ONU-CATV_SpecSheet_27122024.pdf) [Excerpt]; [C-COR Indoor CATV FTTH Receiver](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_Indoor-CATV-FTTH-Receiver_2.2.pdf) [Excerpt]
- Integrator advice: keep the xPON pass port passive and straight-through, and feed the 1550 nm signal into the EDFA input. A standard CATV EDFA amplifies only 1550 nm — [Premlink, Choosing a WDM EDFA](https://www.premlink.net/choosing-a-wdm-edfa-guide/) [Excerpt, vendor-integrator]
- A vendor claim says PLC splitters pass 1310/1490/1550 nm together without separate splitting stages — [TTI Fiber](https://www.ttifiber.com/products/fiber-optic-splitter/) [Excerpt, vendor]

**Pre-DAS STB level requirements (dated)**
- Both analog and digital STBs were required to operate from 47 to 862 MHz, with minimum input 60 dBµV up to 300 MHz and 57 dBµV above 300 MHz, "where the inter channel spacing shifts to 8 MHz (PALG)". Maximum input is 80 dBµV for under 20 channels and 77 dBµV for over 20. Other parameters defer to IS 13420 Part 1 and IS 14231 Part 3, return path to IS 14231 Part 8 — [Satellite & Cable TV magazine, January 2003](https://scatmag.com/uploads/jan_03.pdf) [Read directly; 2003 secondary summary of IS 15244/15245]

### Inferences
- "Mini-node" is ambiguous in Indian listings. Some are passive (photodiode, no power, about 70 dBuV at -1 dBm) and some are powered. The inventory schema should record `powered: yes/no`, because a passive node needs much higher optical input and can feed far fewer TVs.
- Listed mini-nodes state no return path or modem spec. This suggests TV is one-way RF and data rides on GEPON (ONU), so an LCO subscriber may have two logical services on one fiber: PON data and 1550 nm RF. This is an inference from the absence of return specs, not a confirmed survey.
- LCO "HFC" in India may therefore be: EDFA -> fiber splitter -> node -> short coax -> tap or splitter -> TV, with little or no DOCSIS. A tool should not make CMTS/modem mandatory.
- Older MSO DOCSIS deployments may still exist. I have no data on their share.

### Gaps
- I found no reliable Indian source on: LCO/MSO head counts (the TRAI PDFs I searched did not yield them), the share of DOCSIS vs GEPON broadband among LCOs, RFoG use in India, the state of analog carriage, typical LCO coax lengths, or actual operating levels.
- BIS texts IS 15245, IS 16128, IS 13420 and IS 14231 are paywalled and were not read. The 60/57/80/77 dBµV figures come from a 2003 article. One other industry report gave 47 dBµV for TV-receiver input, which conflicts — [IndianTelevision](https://indiantelevision.com/news-headline/specifications-for-indian-stbs-elaborated-upon-at-scat/) [Excerpt; which report gave the figure is not fully certain].
- No primary source from Sumavision, VIP, Dexter or Syrotech was obtained. The first search targeted the topic generally and these brands did not surface.
- Whether Indian digital (DVB-C style) 8 MHz QAM is universal, and exact channel rasters, could not be confirmed. The search did not return DVB-C parameters for India.

## What are the numbers (levels, losses, thresholds, conversions)?

### Takeaway
There are few universal values. Use datasheet values per device, keep every value tagged by unit and source, and treat modem thresholds as DOCSIS-mode-specific. The conversion dBµV = dBmV + 60 is the one hard constant.

### Cited Findings
**Unit conversion**
- 0 dBmV = 60 dBµV, and 40-50 dBmV = 100-110 dBµV — [SpeedGuide](https://speedguide.net/faq/what-cable-modem-signal-levels-are-considered-good-78) [Excerpt]
- [Calc] In 75 ohm, dBm = dBmV - 48.75, so dBµV = dBm + 108.75. Derived from P = V²/75.

**Optical input to node and receiver output**

| Device | Optical input (dBm) | RF output | Band | Source |
|---|---|---|---|---|
| C-Data HF100-3301AF | -18 to +3, recommended -15 to +2, AGC -2 to -12 | 80 dBµV at -8 dBm | 47-1000 MHz | [C-Data](https://www.cdatatec.com/uploads/file/hf3301-baf-l670.pdf) [Excerpt] |
| Televes micro receiver (OLC) | OLC -8 to +1, min -10, max +2 | 80 dBµV (41 channels) | not captured | [Televes](https://www.televes.com/en/231181-domestic-catv-optical-micro-receiver-1550-nm-equipped-with-olc-technology.html) [Excerpt] |
| Softel SR201F | -20 to -1, recommended -15 to 0 | 78±2 dBµV at -10 dBm | not captured | [Softel](https://ee.softelcatv.com/Content/upload/pdf/202024457/SR201F.pdf?rnd=965) [Excerpt] |
| C-COR indoor, metal / plastic | -20 to +2 / -18 to 0 | ≥83 / ≥76 dBµV | not captured | [C-COR receiver](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_Indoor-CATV-FTTH-Receiver_2.2.pdf) [Excerpt] |
| Tejasri 4-port passive node | -15 to +2 | ≥70 dBµV at -1 dBm | not stated | [Tejasri](https://m.indiamart.com/tejasrifibernxttechnology/ftth-nodes.html) [Listing] |

A separate Televes listing gives OLC -10 to -1 dBm, so OLC ranges vary by model — [Televes indoor receiver](https://alltrade.co.uk/shop/televes-indoor-domestic-receiver-scapc) [Excerpt].

**Optical amplifiers**
- C-COR EYDFA: input -10 to +10 dBm (standard) or -3 to +10 dBm (economic). Per-port output 17 to 23 dBm, adjustable 0 to -4 dB. Noise figure ≤6 dB. Typical CNR 51 dB, CTB 65 dB, CSO 65 dB — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]
- Total-output table, 20 dBm per port: 28 / 31 / 34 / 38 / 41 dBm at 4 / 8 / 16 / 32 / 64 ports — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf) [Datasheet]
- Televes 1550 nm GPON EDFA: 20 dBm output at 1550 nm, RF-overlay input -5 to +10 dBm — [Televes via Alltrade](https://www.alltrade.co.uk/shop/televes-t0x-edfawdm-8-out-1550nm-2) [Excerpt]

**RF amplifiers**
- Teleste CX3: forward gain 43 dB, return gain 28 dB, Umax 110 dBµV (138 channels), forward noise figure 9 dB, return 6.5 dB. Input attenuator 0-20 dB, input equalizer 0-20 dB, cable simulator 0/13 dB, interstage attenuator 0/8 dB, interstage equalizer 0/13 dB, return output attenuator 0-20 dB, return equalizer 0-15 dB, return Umax(in) >72 dBµV — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf) [Datasheet]. Values are "typical".
- Lower-gain repeater Teleste 3RE100-10S-AR: Umax 99 dBµV, gain 12.5 dB, remote current <7 A — [Teleste 3RE100-10S-AR](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_3RE100-10S-AR_20260522.pdf) [Excerpt]
- Umax is a maximum rating and is not an operating level. I found no recommended operating output table, so a tool should store per-node designed levels and not assume one.

**Taps: through (insertion) loss at 5 MHz, 4-port, typical/mean and max**

| Tap value | Cisco 4-way MMST | ATX GigaXtend XS |
|---|---|---|
| 8 dB | blank at low frequency | not captured |
| 11 dB | 3.45 / 3.9 | 3.4 / 3.9 |
| 14 dB | 1.91 / 2.4 | 3.1 / 3.6 |
| 17 dB | 1.16 / 1.7 | 2.2 / 2.7 |

Sources: [Cisco tap datasheet](https://www3-realm.cisco.com/en/US/prod/collateral/video/ps8806/ps9075/ps9091/product_data_sheet0900aecd806c7a16.pdf) (fetch timed out) and [ATX GigaXtend](https://atx.com/products/taps-passives/gigaxtend-xs-series-2ghz-taps-passives/2ghz-gigaxtend-hardline-multiport-taps) (404 on fetch) [both Excerpt from garbled PDF/HTML]. The 14 and 17 dB rows disagree noticeably, and I could not confirm them, so treat this as illustrative only. Consistent across sources: through loss falls as tap value rises, and a 12 dB tap has lower through loss than an 8 dB tap — [MATV tutorial mirror](https://pe2bz.philpem.me.uk/Parts-Active/IC-Analog/OpAmps/OpAmpMyths/Catv/matvbil1.htm) [Excerpt].

**Splitters**
- 2-way: real-world 3.5-3.8 dB at low frequency, up to 5-5.5 dB at the top of the CATV/MATV band, plan on 4 dB. 4-way: 7.5-8 dB. 8-way: 11-12 dB — [MATV tutorial mirror](https://pe2bz.philpem.me.uk/Parts-Active/IC-Analog/OpAmps/OpAmpMyths/Catv/matvbil1.htm) [Excerpt, RoT]
- Thor lists 8 dB for 4-way and 11.5 dB for 8-way — [Thor Broadcast](https://thorbroadcast.com/es/producto/caox-multiplexers-splitters-combiners-f-type-input-ouput-catv-atsc-or-8230.html/259) [Excerpt]
- A 3-way can be unbalanced: Pico Macom lists 3.5 dB and 7.0 dB on different ports — [Pico Macom TSV spec](https://manualmachine.com/picomacom/tsv2/20579276-specifications) [Excerpt]
- ANSI/SCTE 153 covers splitter and coupler classes with allowable insertion loss tables. Values were not retrieved — [ANSI/SCTE 153 2021](https://scte-prod.herokuapp.com/documents/4993/ANSI_SCTE_153_2021.pdf) [Excerpt]
- So the user-suggested 2-way 3.5 dB and 4-way 7 dB are low-end nominal values. Sources favour 4 dB and 7.5-8 dB for planning.

**Coax attenuation (dB per 100 ft unless stated)**

| Cable | 55 MHz | 211 MHz | 700-750 MHz | ~1000 MHz | Source |
|---|---|---|---|---|---|
| .500 hardline (generic) | 0.54 | 1.09 | - | - | [Broadband Library, Hranac](https://broadbandlibrary.com/coaxial-cable-attenuation/) |
| P3 500 | - | - | 2.16 (7.09 dB/100 m) | 2.54 at 1002 MHz (8.32 dB/100 m) | CommScope via search [Excerpt; specific PDF not confirmed] |
| P3 625 | - | - | 1.78 (5.84 dB/100 m) | 2.11 at 1002 MHz (6.92 dB/100 m) | [CommScope P3 625](https://es.commscope.com/catalog/cables/product_details.aspx?id=47012) [Excerpt, jacket variants differ] |
| RG11 (SureCall) | - | - | 11.90 dB/100 m max at 750 (about 3.63, Calc) | - | [SureCall RG11](https://powerfulsignal.com/content/surecall-sc-rg11-data-sheet.pdf) [Excerpt] |
| RG11/U 4476 (generic) | 0.89 at 50 MHz | - | 3.80 at 700 MHz | 5.00 | [Conwire](https://www.conwire.com/product/75-ohm-coax-6/) (max is 10% higher) |

- Attenuation rises roughly as the square root of frequency, so quadrupling frequency roughly doubles dB loss — [Broadband Library, Hranac](https://broadbandlibrary.com/coaxial-cable-attenuation/) [RoT, read directly]
- [Calc] Check: 1.09 × √(750/211) = 2.05 dB/100 ft, close to the listed 2.16 for P3 500, so the rule is usable for interpolation but not for final figures.

**DOCSIS levels and thresholds**

Directly read from [VIAVI DOCSIS 3.1 poster, 2017](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf) [Datasheet-grade]:

| Constellation (up to 1 GHz) | Min CNR (dB) | Min P6AVG (dBmV) |
|---|---|---|
| 4096 | 41.0 | -6 |
| 2048 | 37.0 | -9 |
| 1024 | 34.0 | -12 |
| 512 | 30.5 | -12 |
| 256 | 27.0 | -15 |
| 128 | 24.0 | -15 |
| 64 | 21.0 | -15 |
| 16 | 15.0 | -15 |

- Same poster, recommended OFDM checks: average level >-6 dBmV, average MER >36 dB, MER at 2nd percentile >35 dB, level standard deviation <2 dB. PLC level >-15 dBmV (6 MHz), PLC MER >15 dB. Stable MER above 40 dB suggests QAM 2048 and 4096 work, and unstable MER dropping below 30 dB suggests 256 QAM or lower — [VIAVI poster](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf)
- For 8 MHz SC-QAM systems, set OFDM level (referenced to 6 MHz) 1.2 dB below the 8 MHz 256-QAM carriers, for equal power per Hz. Total OFDM power differs from 6 MHz-referenced power: a 96 MHz carrier is 12.04 dB higher, a 192 MHz carrier 15.05 dB higher — [VIAVI poster](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf)
- OFDM input range -15 to +15 dBmV per 6 MHz — [Volpe, DOCSIS 3.1 OFDM measurements](https://volpefirm.com/wp-content/uploads/2025/04/DOCSIS-3.1-OFDM-measurements-generic.pdf) [Excerpt]
- Bonded SC-QAM per-channel input of about -17 to +13 dBmV and -13 to +17 dBmV depending on symbol rate ("Table B-16 in the DOCSIS 3 spec") — [Virgin Media community primer](https://community.virginmedia.com/t5/Speed/POWER-LEVELS-amp-SNR-A-TECHNICAL-PRIMER-updated-October-2016/m-p/2271603) [Excerpt, forum; attribution within search results not fully confirmed, fetch failed]. [Calc] Equals 43-73 and 47-77 dBµV.
- Ideal modem downstream 0 dBmV (60 dBµV), ideal upstream transmit 40-50 dBmV (100-110 dBµV) — [SpeedGuide](https://speedguide.net/faq/what-cable-modem-signal-levels-are-considered-good-78) [Excerpt, RoT]
- SNR: 64-QAM ≥23.5 dB, 256-QAM ≥30 dB — [ARRIS SB6182 support](https://arris.force.com/consumers/articles/General_FAQs/SB6182-Cable-Signal-Levels) [Excerpt, fetch 404]
- Consumer guide bands, low authority: SC-QAM downstream good ±7 dBmV, marginal to ±10; OFDM good ±15, marginal to ±18; 256-QAM SNR good >30, bad <27; 64-QAM good >23.5, bad <20; SC-QAM upstream good 38-48 dBmV, bad above 51 or below 35; OFDMA good 34-44, bad above 48 — [SpeedTestHQ guide](https://speedtesthq.com/guides/diagnostics/read-docsis-modem-signal-levels) [Excerpt]
- Upstream maximum depends on bonding: an ARRIS page lists 57 / 54 / 51 dBmV for 1 / 2 / 3+ channels — [ARRIS TM822](https://arris.force.com/consumers/articles/General_FAQs/TM822G-NA-Cable-Signal-Levels) [Excerpt, attribution not fully confirmed]. The excerpt called these "downstream" channels. Hranac's bonding articles frame the power limit as upstream, so I think that wording is an error; verify.
- DOCSIS 3.1 modem max transmit may be limited to 48 dBmV with more than four upstream channels bonded unless it has the extended transmit ECN — [Volpe, DOCSIS 3.1 cable modem transmit power](https://volpefirm.com/docsis-3-1-cable-modem-transmit-power) [Excerpt]; [Broadband Library](https://broadbandlibrary.com/cable-modem-transmit-power/) [Excerpt]
- Lower per-channel power in bonded operation reduces CNR and MER; reported "upstream SNR" is really MER — [Cablefax, Hranac](https://www.cablefax.com/archives/more-on-cable-modem-upstream-signal-levels) [Excerpt]

**Powering numbers**
- Coax carries 60 V AC or 90 V AC, 60 Hz quasi-square wave. In the US, NESC allows up to 90 V AC while NEC allows only 60 V AC on the carrier to the home — [NCTA 1995](https://www.nctatechnicalpapers.com/Paper/1995/1995-transmitting-power-in-the-90s-architectures-and-systems/download) [Excerpt, US-specific, old]
- Example design criteria: minimum 50 VAC at any node, total supply loading 14 A or less, 87 VAC recommended over 60 VAC after summer outages. A 60 VAC design at 21.8 A and 47 VAC minimum was rejected — [Bowers, Basic HFC AC Design Part Two](https://broadbandlibrary.com/basic-hfc-ac-design-part-one-2/) [Read directly; example values, not a standard]
- Teleste CX3 accepts 180-255 VAC (local) or 28-65 VAC (remote) at 18 W — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf). So the European-style remote range differs from 60/90 V US practice.
- Cisco GainMaker: 60 V and 90 V AC capability, 15 A steady, 25 A surge — [Cisco GainMaker](https://www.cisco.com/c/en/us/products/collateral/video/gainmaker-amplifiers/datasheet-c78-732211.html) [Excerpt; fetch returned only the Cisco homepage]. FlexNet: 40-90 V — [C-COR FlexNet900](https://www.artisantg.com/info/CCOR_FlexNet900_Datasheet.pdf) [Excerpt]

### Inferences
- [Calc] Passive-node budget example: ≥70 dBµV at -1 dBm against a 57 dBµV UHF minimum (2003 figures) leaves about 13 dB, which is one 4-way splitter (about 8 dB) plus a short drop. At lower optical input it shrinks quickly. This supports recording optical input level for every passive node. Both figures are dated or listing-grade, so this is illustrative.
- [Calc] Active receiver example: 80 dBµV output minus an 8-way (about 11.5 dB) and 30 m of RG6 at 750 MHz (about 5.5 dB, using the low-confidence RG6 figure below) leaves about 63 dBµV, within the 57-77 dBµV window.
- Store values with explicit unit and always display both dBmV and dBµV. Indian meters and datasheets use dBµV, while DOCSIS literature uses dBmV, so a 60 dB offset is the likeliest data-entry error.
- Validation thresholds should be configurable by profile (Indian TV STB, DOCSIS 3.0, DOCSIS 3.1), not hardcoded.

### Gaps
- **RG6 at 750 MHz:** search excerpts gave about 5.65 dB/100 ft and 17.52 dB/100 m (about 5.34 dB/100 ft, Calc), but I could not confirm which datasheet each came from. Candidates: [RG6 814BK spec](https://cdn.shopify.com/s/files/1/0086/4547/6409/files/RG6-814BK-SPEC.pdf), [RG6 823 spec](https://cdn.shopify.com/s/files/1/0086/4547/6409/files/RG6-823-SPEC.pdf). Treat as low confidence.
- **Normative CableLabs PHY text was not retrieved**, and the search found none. The widely quoted D3.0 downstream range of -15 to +15 dBmV (North American annex) and the tighter European -17..+13 / -13..+17 pairing are from memory or excerpt; check the DOCSIS PHY specification.
- **Not found:** typical node or amplifier *operating* output levels, recommended tilt, tap value vs distance tables, or an India-specific level plan. Also not found: 1218 or 1800 MHz tap loss data, drop passives, a clean upstream MER threshold table, DVB-C reception thresholds.
- **Not verified this session (background knowledge):**
  - RF output from a receiver without AGC changes about 2 dB per 1 dB optical change. AGC or OLC masks this in the window.
  - Ideal splitter loss is 3.01 dB per 2-way (10 log 2, Calc).
  - Tilt: amplifier output is set higher at high frequency to compensate coax loss.

## What are the connection rules and common mistakes?

### Takeaway
Rules are directional: fiber feeds a node, node RF output feeds cable, amp input comes from upstream and output goes downstream, tap IN and OUT stay on the main line and only drop ports go to subscribers. Sourced evidence covers most but not all of this; the rest is flagged as unverified.

### Cited Findings
- Tap losses are separate quantities: through (in-to-out) insertion loss is distinct from the tap value at the drop port. Datasheets publish insertion loss per tap value and frequency — [Cisco tap datasheet](https://www3-realm.cisco.com/en/US/prod/collateral/video/ps8806/ps9075/ps9091/product_data_sheet0900aecd806c7a16.pdf) [Excerpt; the distinction was stated in a search summary, and the PDF timed out]
- Taps typically block AC from drop ports — [US patent 5909154](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5909154) [Excerpt]
- Amplifier: block diagram shows INPUT and OUTPUT 1 and OUTPUT 2 with 20 dB test points; AC passing is model-dependent ("only in CX3R models", "only in latest CX3R models") — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf)
- Power-related accessory exists as a separate part: "KPA002-5/8 Power inserter adapter with cord" — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf)
- Power inserter output legs can overload: one 60 VAC case had almost 11 A on one side. Many inserters will not handle that on one output leg. Supply placement should be modelled iteratively, because switch-mode loads draw more current as voltage drops. Voltage at each device must stay above the manufacturer minimum — [Bowers, Broadband Library](https://broadbandlibrary.com/basic-hfc-ac-design-part-one-2/)
- Cascade: a 1996 paper cites a historical limit of two trunks, one terminating bridger and three line extenders — [NCTA 1996](https://www.nctatechnicalpapers.com/Paper/1996/1996-ingress-margin-improvement-in-sub-low-return-hfc-plant/download) [Excerpt, dated]. A glossary states "3-5 amplifiers maximum in modern HFC" — [RF Essentials](https://rfessentials.com/resources/rf-glossary/cable-amplifier/) [Excerpt, not authoritative]. No standard limit was found.
- Optical wiring: OLT goes to the PON input port, video to the video input, and the COM port goes to ONTs. Connectors differ: LC/UPC from OLT and LC/APC to ONT — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf). Return loss is at least 55 dB on the APC video input and COM output, and at least 45 dB on the UPC OLT input. Video inputs are SC or FC.
- C-Data's receiver is SC/APC — [C-Data](https://www.cdatatec.com/uploads/file/hf3301-baf-l670.pdf) [Excerpt]

**Common mistakes with some source support**
- Treating total OFDM power as if it were per-channel level; do not use total OFDM power to set levels — [VIAVI poster](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf)
- Designing 60 VAC where voltage sag causes outages; overloading a single inserter leg — [Bowers](https://broadbandlibrary.com/basic-hfc-ac-design-part-one-2/)
- Trusting map footage: 102 ft measured vs 105-110 ft recorded in an example — [Bowers](https://broadbandlibrary.com/basic-hfc-ac-design-part-one-2/)
- Mixing tap loss and through loss in design — [Cisco tap datasheet](https://www3-realm.cisco.com/en/US/prod/collateral/video/ps8806/ps9075/ps9091/product_data_sheet0900aecd806c7a16.pdf) [Excerpt]
- Assuming a 3-way is balanced — [Pico Macom](https://manualmachine.com/picomacom/tsv2/20579276-specifications) [Excerpt]
- Using a plain 1550 nm EDFA to carry PON wavelengths; standard CATV EDFAs amplify only 1550 nm — [Premlink](https://www.premlink.net/choosing-a-wdm-edfa-guide/) [Excerpt]
- Loose or corroded connectors, overly long cable runs, and faults at ground block, multiswitch or tap — [Tequipment overview](https://tequipment.net/signal-level-meters-catv-cctv-satellite) [Excerpt]

### Inferences
Suggested validator rules (each rule follows from the above, but is not a standard):
- `Tap.drop` connects only to drop cable, ground block or splitter on the subscriber side. Never to a hardline or feeder continuation. Warn on a missing downstream `Tap.out` termination.
- `Tap.in` and `Tap.out` carry AC; `Tap.drop` carries no AC unless explicitly flagged.
- Amp `input` must face upstream, and outputs must face downstream. Direction is a property of the path, not the geometry.
- Optical port cannot connect to RF port except through a node, receiver or R-ONU element. EDFA input accepts 1545-1565 nm, so a 1310 nm transmitter feeding an EDFA should raise an error.
- PON ports must connect through a WDM or PON port on a WDM EDFA. Warn on connector type mismatch (APC vs UPC).
- Cascade warning should be a configurable threshold, because no standard limit was found.
- Power: compute AC along power-passing elements only, warn below a device minimum voltage, warn on inserter-leg over-current.

### Gaps
- I did not retrieve an SCTE operational practice on tap/amp connections, or an authoritative current N+x cascade statement.
- Not verified this session (background knowledge):
  - Unused tap ports should be terminated with 75 ohm terminators to limit ingress and reflections.
  - Feeder ends need a terminator or a terminating tap (a 4-way 8 dB tap being blank at low frequency in the Cisco table may reflect this).
  - Power-passing taps pass AC IN to OUT, and some have a power-block option.
  - An amp fed in reverse, or an unterminated port, causes reflections.

## Which measurements exist only if a device exposes them, and how does a field worker measure?

### Takeaway
Passive plant exposes nothing, so its levels are either calculated or measured with a meter. Amps expose test points and sometimes local readouts; head-end optical gear and DOCSIS modems report digitally. The tool should mark each value as designed, calculated, field-measured or device-reported.

### Cited Findings
- **EYDFA:** front panel LCD, web-based SNMP and RJ45/RS232 management, and an optional video RF test port at 78-82 dBµV — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf)
- **RF amp:** Teleste CX3 has 20 dB test points (F male) and a local UI with 7-segment display and three buttons. The datasheet excerpt lists no telemetry or transponder — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf)
- **CMTS and modem:** some CMTSs report per-modem upstream SNR, which is really MER — [Cablefax, Hranac](https://www.cablefax.com/archives/more-on-cable-modem-upstream-signal-levels) [Excerpt]. Modem receive, transmit and SNR can be read from status pages — [SpeedGuide](https://speedguide.net/faq/what-cable-modem-signal-levels-are-considered-good-78) [Excerpt]
- **SLM capability:** handheld meters show analog and digital level, MER, pre/post BER, constellation, equalizer taps, plus channel-plan scan with tilt — [Viavi 120 DSP](https://www.viavisolutions.com/de-de/literature/120-dsp-discontinued-data-sheets-en.pdf) [Excerpt]; [Trilithic 120 DSP datasheet](https://www.normann-engineering.com/products/product_pdf/measurement_equipment/trilithic/120_DSP_Datasheet.pdf) [Excerpt]
- Tuned to a QAM carrier in level mode, DSAM-6300 reports MER, BER and errored seconds together; tilt mode compares low and high frequency levels across the forward band — [JDSU DSAM-6300](https://www.electronicsdatasheets.com/download/54da101be34e2421522db7da.pdf?format=pdf) [Excerpt]
- **Where to test:** at the tap or ground block, looking back into the home, with ingress visible in the scan — [Viavi installation test guide](https://www.viavisolutions.com/en-uk/literature/cable-subscriber-installation-test-guide-brochures-en.pdf) [Excerpt]
- Probes can thread into an unused tap port and feed a 20 dB resistive test point onto the hardline — [Viavi 180/360 DSP](https://www.viavisolutions.com/en-uk/node/110125) [Excerpt]
- **Compare locations:** DOCSIS 3.1 profile lock varies between Tap, Ground Block and Outlet/CPE; profile availability changes highlight drop or home-wiring problems — [VIAVI poster](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf)
- **Autotest:** can flag poor MER, BER, C/N, hum and adjacent-channel problems — [Viavi DSAM guide](https://www.Viavisolutions.com/sites/default/files/support/DSAM%20find%20and%20fix%20guide.pdf) [Excerpt]
- **Optical:** a USB optical power meter and fiber scope are add-ons to field meters — [VIAVI poster](https://www.normann-engineering.com/support/presentations/{8db11f80-96de-453e-bdb5-d060db6bae9e}_VIAVI_DOCSISPoster_v9_FINAL.pdf)

### Inferences
- Test point readings must add the test-point loss (20 dB on the CX3), or the tool will under-report by 20 dB. Record `test_point_loss_db` with each reading.
- Suggested measurement record: location (port), timestamp, instrument, frequency or channel, level + unit, MER, BER pre/post, tilt, temperature (optional), technician, and origin (`designed|calculated|field_measured|device_reported`).
- Never show calculated values as measured. Taps, splitters, couplers and coax cannot report anything.
- In India, LCO gear such as passive nodes probably exposes nothing at all. This is an inference from the listings, which mention no management.

### Gaps
- I did not find a step-by-step SCTE SLM procedure with target values. Search returned vendor material only.
- Which Indian EDFAs or nodes support SNMP was not established per model.

## How do mapping and inventory tools represent HFC, and what do they record?

### Takeaway
Dedicated coax tools model strand or route first, then place nodes, taps and amps on it with catalog values, and calculate signal levels and tap sizing live. Mainstream fiber-first tools (VETRO, likely 3-GIS) show no clear coax model in what I could find.

### Cited Findings
- **Bentley Coax:** builds a network model from existing strand and landbase data, using graphical routing based on poles, pedestals, manholes and duct. It offers real-time signal calculations and tap sizing, and checks strand and duct footages against cable lengths — [Bentley Coax product data sheet](https://es-la.bentley.com/pds-bentley-coax-ltr-en-lr) [Excerpt; fetch 404 on redirect]
- **Bentley OpenComms Designer** help pages exist as a related product — [Bentley docs](https://docs.bentley.com/LiveContent/web/OpenComms%20Designer%202023%20Help-v2/en/GUID-883BFE75-0CDB-4246-8831-20D90A83FF32.html) [Excerpt; content not read]
- **Schneider Designer HFC (ArcFM on ArcGIS):** placement occurs on strand points. By default it places a node at the first click and taps on later points using catalog defaults — [Schneider Place RF Network Components](https://www.productinfo.schneider-electric.com/arcfmsolution/5b9145ca62e672000167792a/Designer%20Hybrid%20Fiber%20Coax/English/Designer%20Hybrid%20Fiber%20Coax%20(bookmap)_0000232414.xml/$/PlaceRFNetwork_30) [Excerpt]
- Amplifier configuration allows at most three profiles, with a combined maximum of 5 outputs — [Schneider Amplifiers Properties](https://www.productinfo.schneider-electric.com/arcfmsolution/dhfc-with-arcgis-pro/DHFC%20Config/English/Designer%20Hybrid%20Fiber%20Coax%20Config%20Guide%20(bookmap)_0000282840.xml/$/CoaxAmplifiers_37) [Excerpt; fetch 403]
- **Mapcom M4 Coax:** HFC coax management module extending M4 Foundation, sourcing data from Lode Data's Design Assistant — [Mapcom](https://www.mapcom.com/?p=1903) [Excerpt]
- **SPATIALnet:** covers CAD-scraping of landbase and strand data, adding HFC nodes, taps and amplifiers, and editing signal levels — [SPATIALnet FM Tutorial](https://www.topslab.wisc.edu/its/inventory/resources/SpatialInfo/SpatialNet/Documents/SPATIALnet_FM_Tutorial.pdf) [Excerpt, about 2004]
- **3-GIS:** core product manages telecom assets, inventory records, connectivity, service paths and operational data, with copper infrastructure integration. No explicit HFC element types found — [3-GIS asset and inventory](https://www.3-gis.com/telecom/telecom-asset-inventory-management) [Excerpt]; [3-GIS Web Copper](https://3-gis.com/software/3-gis-web-copper) [Excerpt]
- **VETRO FiberMap:** described as FTTx mapping and fiber management GIS, with strand, circuit path and splicing coverage. No coax plant components found — [Lightwave on VETRO](https://www.lightwaveonline.com/fttx/ftth-b/article/16654784/vetro-fibermap-offers-cloud-based-fttx-network-mapping) [Excerpt]
- **Data quality problem:** HFC element and connectivity information in operator databases is "sometimes inaccurate, out-of-date, or even missing" — [NCTA 2023, Cheng](https://www.nctatechnicalpapers.com/Paper/2023/3623_Cheng_5154_paper/download) [Excerpt]
- Operators are automating map recording to deal with this — [NCTA 2024, Schlack](https://www.nctatechnicalpapers.com/Paper/2024/OPS06_Schlack_6388_paper/download) [Excerpt]
- Plant data aggregated at amp level informs where to place a new node — [NCTA paper via search](https://www.nctatechnicalpapers.com/Paper/2022/FTF22_TOOLS01_Schlack_3712/download) [Excerpt; attribution among NCTA papers not certain]

### Inferences
- A sensible Indian LCO tool: pole- or route-based placement like Bentley and Schneider, catalog-driven parts, live forward-level calculation, and a design vs as-built split, while allowing a lower-rigour mode (LCO records often lack footage or tap detail).
- The Schneider "profile" concept fits the CX3's configurable outputs and gain modes.

### Gaps
- No vendor documentation confirms 3-GIS or VETRO coax support. Absence in search is not proof of absence, so ask the vendors directly.
- The C-COR-to-Lode Data lineage in the question was not confirmed; only Mapcom's use of Lode Data's Design Assistant surfaced. C-COR Broadband Australia, the datasheet source here, may be a separate company from the historic US C-COR.
- Bentley and Schneider attribute lists were not read in full, because fetches failed.

## How does HFC / Cable TV differ from PON / FTTH for a mapping tool?

### Takeaway
PON is a passive optical tree with a dBm budget and logical OLT/ONU services. HFC adds active RF stages, frequency-dependent loss, AC power and bidirectional band splits. Indian overlay networks combine both on one fiber, so the model needs both layers.

### Cited Findings
- Same fiber, different wavelengths: PON 1490/1310 nm (and 1577/1270 nm for 10G) and video 1550 nm — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf)
- PON pass ports are low-loss (≤0.8 dB) through the WDM EDFA, while video is amplified at the same device, so PON and video have different budgets through one box — [C-COR EYDFA datasheet](https://c-cor.com.au/wp-content/uploads/2017/09/C-COR_DS_1550_EYDFA_2.3.pdf)
- Coax loss depends on frequency (about the square root of frequency) — [Broadband Library, Hranac](https://broadbandlibrary.com/coaxial-cable-attenuation/)
- Actives in coax have gain, tilt-related equalizers, and return paths with their own band splits — [Teleste CX3 datasheet](https://www.teleste.com/wp-content/uploads/2026/06/Teleste_Datasheet_CX3_260225.pdf)
- Coax carries AC power to actives — [NCTA 1995](https://www.nctatechnicalpapers.com/Paper/1995/1995-hybrid-fffier-coax-network-powering-issues/download) [Excerpt]
- RFoG sits between the two: PON-like fiber plant with RF at the end point, and an upstream collision risk (OBI) unlike PON's managed upstream — [Wikipedia: RFoG](https://en.wikipedia.org/wiki/Radio_frequency_over_glass) [Excerpt, secondary]

| Aspect | PON / FTTH | HFC / Cable TV | Source basis |
|---|---|---|---|
| Medium | Fiber to end point | Fiber to node, then coax | Findings above |
| Power units | dBm (optical) | dBm to node, then dBµV or dBmV | Findings above |
| Loss model | Flat per wavelength | Rises with frequency in coax | Hranac |
| Outside plant actives | None between OLT and ONU | Nodes and amps | Teleste, Wikipedia |
| AC power on cable | No | Yes on trunk and feeder | NCTA |
| Service attach | ONU | STB, modem or CATV-ONU | C-COR, listing |

### Inferences
- Model a fiber span once, and carry a wavelength list on it, so one fiber can serve both PON and CATV layers.
- Run two calculations on the same physical path: PON budget in dBm, RF overlay from EDFA port to receiver in dBm, then RF in dBµV.
- Reuse existing PON splitter records for the overlay, because the optical path is shared, but the 1550 nm splitter loss is not necessarily identical. Add a per-wavelength loss field if the catalog gives one.

### Gaps
- I did not confirm per-wavelength PLC splitter loss or a typical 1550 nm overlay budget. The only support is a vendor's general claim that splitters pass all three wavelengths.
- This table's "None between OLT and ONU" and "No AC on PON" rows reflect general PON understanding rather than a specific source retrieved here; the parallel PON research should confirm them.
