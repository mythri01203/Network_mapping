# OSP field mapping in GIS: what to record and how to capture it on a phone (India focus, as of Nov 2026)

Reading key used throughout:
- **[read]** = I read the page or PDF text directly.
- **[snippet]** = taken from a search-result extract only. The full page was blocked or not opened, so verify before quoting as fact.
- **[RoT]** = rule of thumb, not a standard.
- **[calc]** = my own arithmetic, not from a source.

## Phone GPS: real-world accuracy, browser values, methods, thresholds, imagery offset

### Takeaway
Plan for about 5 m at best under open sky and considerably worse beside buildings. A browser `accuracy` value is now specified as a 68% radius rather than 95%, so true error is often larger than the number shown. Imagery in India has its own error of about 4 to 7 m, so snapping to imagery improves the shape of a route and its relative position, but does not guarantee better absolute position.

### Cited Findings

**Accuracy in practice**
- GPS-enabled phones are typically accurate to about 4.9 m under open sky, and worse near buildings, bridges and trees. US government accuracy commitments cover the satellite signal, not the receiving device — [gps.gov](https://www.gps.gov/node/70) [snippet; the older URL returned 404].
- A Redmi K60 Ultra (multi-frequency) reached RMS errors under 1.5 m in open sky, under 2.5 m in "realistic" settings and under 4 m in challenging urban settings, using A-GNSS PPP-B2b research processing. 3D-mapping-aided GNSS improved urban results by over 30% — [EurekAlert, 2024](https://www.eurekalert.org/news-releases/1054975) [snippet].
- Dual-frequency Xiaomi Mi 8 results: 20 cm horizontal RMS in static open sky with an RTK setup, but 7 m horizontal RMS kinematic on a car dashboard — [Springer/Satellite Navigation](https://link.springer.com/10.1186/s43020-021-00042-2) and [PMC8577807](https://pmc.ncbi.nlm.nih.gov/articles/PMC8577807) [snippet; I cannot confirm which of the two carries which figure]. Another result: 40 cm average horizontal error with dual-frequency PPP, after 38 minutes of convergence in ideal open sky [snippet, same result set].
- Caveat from the literature: most smartphone GNSS tests are static, open-sky and ideal, while real use is kinematic and urban [snippet, same result set].
- A 2023 ISPRS study found few-decimetre to metre-level positioning achievable with a dual-frequency phone and a Kalman filter on open-sky control points — [ISPRS](https://isprs-archives.copernicus.org/articles/XLVIII-1-W1-2023/451/2023/) [snippet].
- The first mass-market dual-frequency chip (Broadcom BCM47755, L1/E1 + L5/E5) shipped in the Xiaomi Mi 8 in May 2018 — [PMC9788430](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9788430/) [snippet]. Raw L5 measurements need Android 12+ (API 31) and L1+L5 hardware, and HERE suggests checking capability with GNSSLogger — [HERE docs](https://docs.here.com/here-sdk/docs/flutter-get-locations-optimization) [snippet].
- Field comparison of four devices on the same hike: track totals differed by about 2.2 mi, roughly 13% of the shortest track. On one open ridge a raw track measured 1,307 ft against a traced 1,010 ft (the source calls this a 23% difference; it is 29% longer than the traced length [calc]). Hand-smoothing against imagery cut one track by about 7%. GPS elevation was worse than horizontal, with one device 800 to 1,000 ft above the others. Some Android power-saver modes reportedly switched off GPS (a reader's observation) — [CalTopo blog, 2020](https://blog.caltopo.com/2020/10/12/2232/) [read; hiking context, not telecom].

**What the browser and phone report**
- W3C Geolocation API: `accuracy` is "the 68% confidence level in meters (1 standard deviation)". The changelog says "Update accuracy confidence interval to 68%". The document is a Candidate Recommendation Draft dated 5 Nov 2026 — [W3C](https://www.w3.org/TR/geolocation/) [read].
- This conflicts with MDN, which still describes `accuracy` as a 95% confidence level — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy) [snippet].
- Android `Location.getAccuracy()` is a horizontal radius at the 68th percentile — [Android reference](https://developer.android.com/reference/android/location/Location?hl=cs) [snippet]. An Apple forum thread describes coverage as roughly 63 to 68% — [Apple forums](https://developer.apple.com/forums/thread/699996) [snippet].
- `enableHighAccuracy` is only a hint and defaults to false. `maximumAge` defaults to 0. `timeout` defaults to 0xFFFFFFFF. Non-secure contexts fail with PERMISSION_DENIED, so HTTPS is required. Third-party iframes need `allow="geolocation"` — [W3C](https://www.w3.org/TR/geolocation/) [read].

**How field tools handle accuracy**
- ODK `geopoint`: `capture-accuracy` auto-captures at 5 m or better by default, and ODK does not recommend going below 3 m without an external GPS. `warning-accuracy` turns the dialog red at 100 m or worse by default, and is not enforced. A constraint can enforce it, for example `selected-at(${geopoint_widget}, 3) < 10`. Long-pressed or dragged points store accuracy 0 and altitude 0, which marks them as map-placed. Each point stores lat, lon, altitude and accuracy — [ODK docs](https://docs.getodk.org/form-question-types/) [read].
- ODK `geotrace` has three modes: tap to place, manual button, and automatic at an interval with an optional accuracy requirement. With "None", every interval is recorded — [ODK docs](https://docs.getodk.org/form-question-types/) [read].
- QField: "Averaged positioning minimum count", where you press and hold Add Vertex until the sample count is met. Red, yellow and green accuracy indicator. "Enable accuracy requirement" blocks GNSS-locked vertices while red. Supports external receivers over Bluetooth, TCP, UDP and serial, at typically about 1.5 m without corrections. Receivers must output WGS 84 or coordinates shift. Default expressions can write position values into attributes — [QField docs](https://docs.qfield.org/how-to/navigation-and-positioning/gnss/) [read].

**Imagery offset**
- Google Earth high-resolution imagery in India, checked against purchased WorldView data rather than ground survey: 3.75 to 6.83 m RMSE, 4.51 m best in plains. "Systematic errors are not apparent" in most regions. No obvious image distortion over India. Mountains were worse elsewhere (16.5 m in Israel and Syria) — [ISPRS 2020](https://isprs-archives.copernicus.org/articles/XLIII-B3-2020/1333/2020/isprs-archives-XLIII-B3-2020-1333-2020.pdf) [read].
- Older global benchmark: 39.7 m RMSE from 436 points, 44.4 m in developing countries against 24.1 m in developed ones. This was against Landsat GeoCover in 2008 and is dated — [Potere, PMC3791001](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3791001/) [snippet]. Local RTK studies elsewhere found about 1.3 to 1.5 m — [Duhok study](https://www.sciencegate.app/document/10.25007/ajnu.v7n4a287), [Thailand study](https://doaj.org/article/0a0b463ebf7943cc8cc233d75e24f03c) [snippet; I cannot confirm which link carries which figure].
- The deliberate imagery/GPS offset is a China-specific practice — [Google Earth Blog, 2016](https://www.gearthblog.com/blog/archives/2016/05/controlling-maps-in-the-days-of-satellite-imaging.html) [snippet]. Survey of India's Google complaint concerned boundary depiction, not imagery alignment — [Digit](https://www.digit.in/news/general/soi-files-complaint-against-google-for-inaccurate-maps-24740.html) [snippet].

### Inferences
- **Treat a displayed radius as about 68%.** For a circular Gaussian error, the 95% radius is about 1.6 times the 68% radius [calc: 2.45σ / 1.51σ]. So a reading of "5 m" implies about 8 m at 95%. This assumes the reported value is honest, and multipath in a street canyon can break that assumption.
- **Suggested thresholds [RoT, mine, not from any standard]:**
  - Pole, closure, manhole: accept at 5 m or better. Warn at 5 to 10 m. Above 10 m, require a map-placed correction with a reason.
  - Route vertex: accept up to about 15 m, because the route is anchored by its poles. Do not use raw tracks for length.
  - Rationale: the error must be well under the spacing between neighbouring assets so that the right pole is identified. Store the reported accuracy so these thresholds can be changed later.
- **Averaging.** Tools support it, but I found no measured phone result for it. Multipath and atmospheric errors are correlated over short periods, so a few seconds of readings will not reduce error by √N. Averaging mainly removes jitter. It is cheap and worth doing: stand still, wait for the value to settle, and average a short window [RoT].
- **Record provenance per point:** GPS, GPS-averaged, map-placed or imported, plus accuracy, sample count and timestamp. ODK's accuracy-0 convention shows why this matters: map-placed points must not look perfect.
- **Do not auto-shift to imagery.** India's error (about 4 to 7 m) has no apparent systematic component in the one study found, so a fixed correction has no support. Local visual offset is more likely to be local error, or tall objects seen off-nadir. Pole tops and shadows in imagery may not sit over the pole base [my inference].
- **A 6 decimal place value is enough** (see interchange section). More digits imply precision that does not exist.

### Gaps
- No peer-reviewed study found of ordinary browser-grade phone accuracy in Indian cities, or of NavIC L5 benefit on consumer phones.
- No authoritative pole-versus-route accuracy threshold found in any telecom standard.
- No controlled test found for "wait N seconds" or "average N readings" on phones.
- Only one India-inclusive imagery study was read, and it uses WorldView as reference, not ground truth. Google Maps/Earth imagery alignment in specific Indian cities remains unmeasured.

## Capture workflows and data models: what to record, what tools make easy, what crews complain about

### Takeaway
Tools simplify capture with pre-filled IDs, required photos, constraints, offline caches and one shared system of record. Publicly available material is mostly marketing, so detailed data models and honest complaints are poorly documented. The recording checklist below can be built from FBA, FOA and tool documentation.

### Cited Findings

**What to record (sources)**
- Aerial survey (FBA): pole ownership, pole ID, height, class, wood species; attachment heights and configurations; span lengths; anchor leads and wire diameters; mid-span heights; ground clearances — [FBA Building Better Broadband, ch. 2](https://fiberbroadband.org/resources/building-better-broadband-accelerating-designs-securing-permit-approvals-chapter-two-fielding-and-base-mapping/) [read].
- Underground survey (FBA): pathway feasibility, surface conditions, utility conflicts, crossings, constructability. SUE Quality Level C includes visual identification of manholes, valves and other visible structures. Survey data should record source, collection method and confidence level — [FBA](https://fiberbroadband.org/resources/building-better-broadband-accelerating-designs-securing-permit-approvals-chapter-two-fielding-and-base-mapping/) [read].
- Pole audit form example: pre-filled pole ID; owner (electric, telecom or joint); condition; attachments (multi-select); clearance issues (conditional); photos of top, base and attachments; action needed — [Atlas](https://atlas.co/blog/field-app-for-telecom-outside-plant-fiber-and-cell-site-operations/) [read; vendor].
- Closure and splice: location, type, capacity; splice diagrams as attachments; slack storage location and length; test results at closure; photos; condition and splice count. Pedestal and vault inspections: condition, water intrusion, lock status. Required photos as compliance evidence — [Atlas](https://atlas.co/blog/field-app-for-telecom-outside-plant-fiber-and-cell-site-operations/) [read; vendor].
- Closures attach to poles with necessary service loops. Loops are secured to a pole at the end of the span, never left hanging mid-span. Telecom cables go in the telecom space, with clearance maintained mid-span — [FOA Aerial Workmanship](https://www.foa.org/tech/ref/OSP_Construction/Aerial_Workmanship.html) [read].
- Underground: excess cable is stored in manholes or handholes, which must fit loops above the recommended bend diameter — [FOA cable guide](https://www.foa.org/tech/ref/OSP/cable.html) [snippet].
- A 10,000-pole survey captured attachments, spans and attachment-licensing attributes — [Fulcrum/Tilson](https://fulcrumapp.com/customer-stories/tilson/) [snippet; vendor].

**How tools simplify things**
- 3-GIS: field and design share one web system of record. Crews capture pole-loading data during construction ride-out and rate poles red, yellow or green for permit ease. The vendor claims draft time shortened by over half — [3-GIS blog](https://www.3-gis.com/blog/navigating-the-network-lifecycle-field-verification) [read; vendor]. Mobile supports redlines, inspections and outage tracing — [3-GIS](https://www.3-gis.com/telecom/fiber-construction-field-operations) [snippet; vendor].
- VETRO Mobile: offline editing with auto-sync; mark-ups, photos and materials tied to network records — [App Store](https://apps.apple.com/us/app/vetro/id6469007009) [snippet; vendor]. Change Sets manage redlines, photos, notes and sketches back at the office — [ISE](https://www.isemag.com/fttx-optical-networks/fiber-installation-deployment/product/55325916/revolutionize-your-field-operations-with-vetro-mobile) [snippet; vendor].
- IQGeo: pole-fielding app uses phone or tablet LiDAR — [IQGeo video](https://video.iqgeo.com/explainer-iqgeo-pole-intelligence) [snippet; vendor].
- QField: domains, defaults and constraints enforce IDs and port rules; offline basemaps and layers; as-builts with attributes and photos; "conflict-safe" QFieldCloud sync — [QField](https://qfield.org/solutions/fibre-and-telecommunication-networks/) [read; vendor].
- ArcFM models fibre slack loops as distinct objects with length taken from footstamp difference — [Schneider ArcFM](https://www.productinfo.schneider-electric.com/arcfmsolution/5b86db0a62e6720001663d70/ArcFM%20Appendix%2010.6.1/English/Appendix%2010.6.1%20(bookmap)_0000231874.xml/$/FiberSlackLoop_4) [snippet].

**Complaints and pitfalls**
- Over-collection adds schedule and cost. Pole owners have different submission requirements, forcing re-collection if not checked first. Base-map errors carry through into design, permits and construction. Multiple field visits result from poor pre-survey coordination — [FBA](https://fiberbroadband.org/resources/building-better-broadband-accelerating-designs-securing-permit-approvals-chapter-two-fielding-and-base-mapping/) [read].
- Claims that Google Earth and ArcGIS are "not suitable" for fibre management, 80% of providers use manual entry, and 75% manage inventory in spreadsheets are uncited and written by VETRO's CEO. Treat them as marketing — [Telecompetitor](https://www.telecompetitor.com/legacy-gis-tools-and-processes-dont-cut-it-for-broadband-infrastructure) [read].
- Field slack layout: length alone is not enough. Loops should go along handhole walls so the centre stays open, and must not be twisted, crushed or piled — [Fiber Done Right, Mar 2026](https://fiber-done-right.beehiiv.com/p/slack-length-vs-slack-layout) [read; newsletter].

### Inferences

Suggested minimum records, combining the sources above with my judgement. Fields marked (A) are absolutely minimum for a small operator; the rest are add-ons.

| Asset | Record |
|---|---|
| Pole | (A) ID; (A) location + accuracy + source; (A) owner (DISCOM/municipal/telco/own/private); (A) material (RCC, steel, rail, wood); (A) photo; power on pole (LT/11 kV/none); condition; attachments; permission reference; street/landmark |
| Aerial span | (A) from pole, to pole; (A) cable ID; (A) mapped length; measured length if known; road crossing yes/no; ground clearance if measured; lashed or self-supporting |
| Cable | (A) ID; (A) fibre count; type (ADSS, armoured, drop); (A) owner; start and end sequential marks; install date |
| Slack loop | (A) location (pole/manhole); (A) length, ideally from mark difference; cable ID |
| Duct | (A) route; (A) count and diameter; depth if seen; occupancy; owner; shared or own; method (open trench/HDD) |
| Manhole/handhole | (A) ID; (A) location; (A) type; cover photo; inside photo; ducts entering; slack stored; water/condition |
| Closure | (A) ID; (A) location and host (pole/chamber); (A) type and capacity; cables in and out; splice count; splice record attachment; slack; test results |
| FAT/splitter | (A) ID; (A) parent closure/OLT port; (A) split ratio; ports used/free; photo |
| Building | (A) name/address; (A) location; entry point; riser/landlord contact; permission status and document; served units; drop from which FAT |
| Permission | (A) authority; (A) type (RoW, DISCOM, NHAI, society); (A) reference no.; (A) dates and expiry; route or poles covered; fee; document scan |

- Separate physical structure, cable and logical connection. Poles and manholes are points. Spans and ducts are links between structures. Cables run through an ordered list of spans or ducts. This is what makes "what is on this pole" and "how long is this cable" answerable. The specific vendor schemas were not public, so this is my inference from FBA, FOA, ArcFM and Atlas field lists.
- Make the easy path very short for field staff: pick from nearby existing poles, tap "next pole", take one photo, and auto-fill the span. Keep required fields to the (A) items and let the office fill in the rest.

### Gaps
- No public documentation retrieved on OZmap, Render Networks, Sitetracker or KoBoToolbox capture flows. They are named but unverified here. Render/VETRO integration exists — [FBA news, 2025](https://fiberbroadband.org/2025/05/29/render-networks-expands-partner-ecosystem-with-vetro-integration-to-advance-broadband-deployment-at-scale/) [snippet] — but I have no details.
- VETRO's data model for poles and slack not found. Help centre not reached.
- No independent field-crew complaint data found (forums, surveys). The "complaints" above are guidance or vendor claims. Treat crew complaints as an open question.

## Asset identification: pole tags, QR labels, naming, duplicates

### Takeaway
There is no Indian or telecom-wide naming standard that I could find. A workable pattern is a system-generated unique ID that never changes, printed on a QR tag, with a separate human-readable name. Duplicates are mostly a workflow problem: check nearby assets before creating one.

### Cited Findings
- Vendors link each pole to a database record via a QR code on a tag — [Camcode](https://www.camcode.com/utility-pole-tags) [snippet; vendor]. Physical identification is claimed to reduce duplicate records and inconsistent naming — [Camcode sell sheet](https://camcode.com/wp-content/uploads/2026/05/Partner-With-Camcode-Sell-Sheet.pdf) [snippet; vendor, not an independent finding].
- FBA surveys record pole ownership and pole ID number — [FBA](https://fiberbroadband.org/resources/building-better-broadband-accelerating-designs-securing-permit-approvals-chapter-two-fielding-and-base-mapping/) [read].
- Atlas's pole audit pre-fills pole ID from the map rather than having it typed — [Atlas](https://atlas.co/blog/field-app-for-telecom-outside-plant-fiber-and-cell-site-operations/) [read; vendor].
- QField uses domains, defaults and constraints to enforce IDs — [QField](https://qfield.org/solutions/fibre-and-telecommunication-networks/) [read].
- Naming precedent from outside telecom: facility-type abbreviation plus site identifier — [FDOT ITS standard naming](https://fdot.gov/traffic/itsfm/standard-naming-convention) [snippet; transport, not FTTH]. See also [NJDOT](https://nj.gov/transportation/eng/elec/ITS/pdf/NAMECONVENTIONS.pdf) [not read].

### Inferences
All [RoT], from my judgement rather than any standard.
- **Keep two identifiers.** An immutable internal ID (short random code on the QR) and a display name. Renames and re-parenting then never break links.
- **Keep third-party numbers separately.** A DISCOM's pole number belongs in `owner_pole_no`, never as the primary key: it may be absent, repeated or repainted.
- **Display name pattern:** `<AREA>-<TYPE>-<SEQ>`, for example `KRM-FAT-0142`, `KRM-CL-0031`, `KRM-P-1207`. Do not encode the parent in the ID, as parents change after re-splicing. For splitters, include the ratio as an attribute.
- **Avoid duplicates:**
  - Before creating a point, list existing assets within about 1.5 times the current GPS radius plus a small margin, and prompt "same as this one?". Include a photo for comparison.
  - Scanning a QR opens the existing record instead of creating one.
  - Prefer linking a span to existing poles rather than drawing free lines.
  - Run an office review for pairs of same-type assets within a few metres, merge them and keep the older ID.
  - Never delete without leaving a pointer from the merged ID.
- **Tags in the field.** Weatherproof tags go at a consistent height on the pole, and on cables at both sides of each closure and at chambers. Attaching anything to a DISCOM pole should follow the pole owner's conditions.

### Gaps
- No Indian convention found for ISP/LCO naming or pole numbering, nor any DoT/TEC labelling rule.
- No independent evidence that QR tags reduce duplicate records.
- No evidence on QR durability under Indian sun and monsoon.

## Measured vs calculated length: sequential marks, slack, sag, why map length under-reports

### Takeaway
A drawn line misses slack loops, vertical drops, routing detours and terminations. Sag itself is tiny, about 0.1%. Raw GPS tracks go the other way and tend to over-report from jitter. Sequential marks read at both ends remain the most reliable measure, and every correction factor found is a rule of thumb.

### Cited Findings
- Sag: "generally limited to <2% of span length", with maximum tension below 30% of minimum breaking strength — [FOA](https://www.foa.org/tech/ref/OSP_Construction/Aerial_Workmanship.html) [read]. OFS span tables assume 1.5% initial installation sag — [OFS IP003](https://www.ofsoptics.com/ip-ofs/IP003%20Aerial%20Installation%20Guidelines%20(Apr%202018).pdf) [snippet; direct fetch failed].
- ArcFM example: a 3,000 ft cable with two 75 ft slack loops gives 3,150 ft. Slack length comes from footstamp differences at loop ends. Glass length equals cable length with a manufacturer-supplied twist factor applied — [Schneider ArcFM Fiber Manager guide](https://www.productinfo.schneider-electric.com/arcfmsolution/fiber-xi-using/Fiber%20XI%20Using/English/Fiber%20Manager%20XI%20Using%20Guide%20(bookmap)_0000621839.xml/$/FiberCableLengthandGlassLengthFXICPT_0000994672) [snippet; fetch blocked with 403].
- Sequential markings: one inspection manual shows marks every 2 ft — [CFX manual](https://www.cfxway.com/wp-content/uploads/2022/09/Ch.-5-Fiber-Optic-Cable_FINAL-REVISED-1.pdf) [snippet]. OTDR and jacket-mark readings can disagree because fibre is longer than the jacket — [Fiber Optic Center](https://focenter.com/optical-cable-measurements-why-dont-otdr-and-jacket-length-markings-agree) [snippet; title and topic only].
- OTDR distance is reported as 2× actual if the round trip is not converted properly — [FOA FAQ](https://foa.org/FiberFAQs.html) [snippet].
- Prints may typically call for examples such as 30 ft at a splice point, 50 ft at a handhole and 100 ft near a cabinet. These are illustrative; plans govern — [Fiber Done Right](https://fiber-done-right.beehiiv.com/p/slack-length-vs-slack-layout) [read; RoT].
- A trade article is reported to advise at least 30 ft excess at each end, and a search result mentioned a target slack of 10 to 15%, but I could not confirm the source of either, so treat both as unverified [RoT] — [EC Mag (blocked)](https://www.ecmag.com/magazine/articles/article-detail/looking-good%21-guidelines-for-aerial-fiber-optic-cable-installation).
- Storage loops: if installed bend radius is 10× cable diameter, loop diameter should be no smaller than 20× [FOA RoT] — [FOA bend radius](https://thefoa.org/tech/ref/install/bend_radius.html) [snippet].
- Raw GPS tracks of the same path differ by 10% or more, and one raw track ran 1,307 ft against a traced 1,010 ft locally — [CalTopo](https://blog.caltopo.com/2020/10/12/2232/) [read].

### Inferences
- **Sag is not the cause of under-reporting.** For a shallow parabola, arc length is about L × (1 + (8/3) × (d/L)²). At 2% sag this adds about 0.11%, and at 1.5% about 0.06% [calc]. That is about 1 m per km. Any "sag factor" of 3 to 5% is really covering other things, and is not physics.
- **Map length under-reports because of:**
  - slack loops at closures, poles and chambers (usually the largest item)
  - vertical runs up and down each pole, and into chambers
  - straight lines drawn across corners, or vertices missing on bends
  - tails and terminations inside closures and racks
  - route deviations not redrawn afterward
- **Build length as a sum, and keep each part separately:**
  `installed length = mapped horizontal length + Σ slack loops + Σ vertical allowance + tails`, then compare to `|end mark − start mark|`.
- **Store three lengths per cable:** `map_length_m` (calculated), `declared/design_length_m`, and `measured_length_m` with method (sequential marks, OTDR, wheel). Display measured length when available and never overwrite one with another. Flag when they differ by more than some tolerance, say 10% [RoT, mine].
- **Mark reading tips [RoT]:** photograph marks at both ends and either side of each loop, because the photo is the proof. Note the unit, as some cable is marked in feet. Watch for cable replaced mid-run (the marks jump). Marks can decrease as well as increase, so use the absolute difference and confirm the direction.
- **Do not measure length from a raw walk track.** Use it as a guide for placing vertices. Jitter inflates it. A measuring wheel or sequential marks beat GPS for length.
- **OTDR length is glass length, and helical excess makes it longer than jacket length.** Do not treat an OTDR event distance as map distance without a correction. Ensure index of refraction is set correctly [FOA-derived, inference].

### Gaps
- No standard or peer-reviewed correction factor found for reconciling map with installed length. Nothing India-specific.
- I did not find an Indian source stating metre-marking practice for OFC, though it is the common description. Check the cable vendor's data sheet.
- Typical loop lengths for Indian aerial FTTH are undocumented in sources I could reach.

## India specifics: RoW Rules 2024, electric poles, NHAI and municipal permissions, trench and duct norms, LCO practice

### Takeaway
Central RoW Rules (effective 1 Jan 2025) give a defined process, a low fee schedule and deemed approval, and require up-to-date digital records for underground networks. But the practical conflict for small ISPs and LCOs is on electric poles: rates differ by state, and DISCOMs and cities have repeatedly cut "unauthorised" cables. Record pole ownership and permission per pole.

### Cited Findings

**Telecommunications (Right of Way) Rules, 2024**
- Notified 17 Sep 2024, effective 1 Jan 2025. Binding without state adoption. Nodal officers to be appointed via the portal. Replaces the 2016 RoW Rules and 2022 Infrastructure Safety Rules — [DoT presentation via West Bengal portal](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read]; [Mondaq](https://www.mondaq.com/india/media-telecoms-it-entertainment/1528814/telecommunication-right-of-way-rules-2024) [snippet].
- Public property process (per DoT slides): clarification once only within 30 days; facility provider responds within 15 days; intent to reject within 45 days; no decision within 67 days means deemed permission; terms letter within next 7 days; 90% fee refund on rejection within 15 days. "Days" includes holidays (Rule 22) — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- **Conflict:** the JSA law-firm summary says authorities decide within 45 days with deemed approval on silence — [JSA via Legal 500](https://www.legal500.com/intelligence/india/media-telecoms-it-entertainment/telecommunication-right-of-way-rules-2024-jsa) [read]. DoT's slides show 45 days as the intent-to-reject point and 67 days as deemed. I give DoT's version more weight, but the gazette (GSR 576(E)) should settle it. I could not read the gazette itself.
- Fees (per DoT slide): one-time application underground ₹1,000/km [6(4)], overground ₹1,000/km [8(4)(b)], establishing a pole NIL [8(4)(c)], tower ₹10,000. Compensation: underground NIL [7(11)], pole NIL [9(2)(b)]. Street furniture: small cell ₹300/yr urban or ₹150/yr rural; **telecom line ₹100/street furniture/yr** [11(8)(b)]. Damage or restoration is at CPWD/PWD rates or a 20% bank guarantee for self-restoration; for HDD, charges cover pit area only. Survey has no fee, with permission within 7 days — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- Public entities shall not levy other fees, rent or charges (slide cites Rules 7(11), 9(9), 12(3), 15(3)) — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- **Records duty (Rule 13):** maintain "up-to-date digital information of underground telecommunication network... including as-built information", at a frequency specified by the Centre, through positional intelligence or other appropriate technology, shared on demand through the portal — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read]. The draft used "real time" — [Draft on TaxGuru](https://taxguru.in/?p=923602) [read]; the final slide wording differs.
- Draft overground application asked for exact latitude and longitude, route plan and technical drawings. Underground asked for network details and as-built drawings. Draft defined a pole as an above-ground structure not exceeding 8 m — [Draft on TaxGuru](https://taxguru.in/?p=923602) [read; draft rule numbering differs from final, check gazette]. I did not confirm that these survive in the final text.
- Private property (Rule 15): written agreement with the owner, no public entity charges; submit details and a structural certificate through the portal. Failing agreement, the District Collector route (Rule 16) has a 60-day total — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- Removal on owner notice (Rule 18): plan within 30 days, complete within 90 days, at provider's cost. Call Before u Dig (Rule 19): provider gives network details within 24 hours in an emergency or 7 days otherwise. Act s.42(1): damaging critical telecom infrastructure attracts up to 3 years or ₹2 crore — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- Temporary overground after damage: no permission, details on portal, restore within 60 days and no later than 90 (Rule 10) — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- Facility provider means the Centre or an "authorised entity". Non-government public-facility owners count as public entities only when notified, "in process" as of that deck — [DoT presentation](https://anumati.wb.gov.in/assets/pdf/PPT-on-The-Telecommunications-Act-2023-RoW-Rules-2024.pdf) [read].
- GatiShakti Sanchar portal (launched 14 May 2022), 36 states and UTs onboarded, integrated with MoRTH and Railways RoW portals — [NBM presentation, Aug 2022](https://eservices.dot.gov.in/sites/default/files/circular-notifications/NBM_presentation_with_Discom_12-Aug-22__Final.pdf) [read]. ISPs can apply for OFC RoW — [Vikaspedia](https://vikaspedia.in/e-governance/online-citizen-services/government-to-business-services-g2b/gatishakti-sanchar-portal) [snippet].

**Electric poles**
- Pole rent table, DoT, Aug 2022 (annual per pole unless noted): Andhra Pradesh ₹600 urban/₹420 rural; Assam ₹1,500; Bihar ₹120 municipal corporation down to ₹60 rural; Haryana ₹500; J&K ₹500; Manipur ₹200 for street-light poles; Odisha ₹100 urban/₹50 rural; Telangana ₹180–240; Delhi ₹20,000 per pole for 5 years. Draft RoW policy recommended max ₹100 — [NBM presentation](https://eservices.dot.gov.in/sites/default/files/circular-notifications/NBM_presentation_with_Discom_12-Aug-22__Final.pdf) [read]. Dated; check current orders.
- Electric poles are named as street furniture, and KSEB's aerial fibre on its poles is cited as a model — [NBM presentation](https://eservices.dot.gov.in/sites/default/files/circular-notifications/NBM_presentation_with_Discom_12-Aug-22__Final.pdf) [read].
- KSEB: ₹300/pole/yr in corporation/municipal areas, ₹145 in panchayats, 3% annual rise, 2021 order — [KSEB order](https://ctvtest.kseb.in/bo/2021/5.b.o._rates_wef_514_2021%20dtd%2001.04.2021dt_05.07.2021.pdf) [snippet]. Quarterly advance billing — [KSEB](https://ctv.kseb.in/bo/2018/GST_Pole%20Rent_2018.pdf) [snippet].
- APDCL asked ₹25/pole/month; operators countered with about ₹5–6 — [Indian Television](https://indiantelevision.com/news-headline/ggctoa-writes-to-apdcl-asks-to-disclose-electric-pole-data-for-guwahati/) [snippet].
- BESCOM: seven-day removal notice in 2023 after a pole collapse injured a student — [The News Minute](https://www.thenewsminute.com/article/internet-services-bengaluru-could-get-affected-bescom-orders-illegal-cable-removal-181534) [snippet]. Later 8 July 2024 deadline, with providers held liable for incidents — [Web Josh](https://webjosh.com/article/the-hindu-impact-bescom-sets-july-8-deadline-for-removal-of-illegal-cables-laid-on-its-infrastructure%C2%A0in-bengaluru-1720262164-4936) [snippet]. A headline reports over 7,000 km removed — [Web Josh](https://webjosh.com/article/bescom-removes-over-7-000-kilometres-of-cables-passing-over-its-infrastructure-in-bengaluru-1731039553-6266) [snippet; headline only; lightly sourced site]. BESCOM offered to rent UG ducts and a later report headline says it is moving toward mandating underground OFC — [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbescom-inches-towards-mandating-underground-ofc-cabling-3460926) [snippet; fetch blocked].
- Disputed permissions: operators say they laid OFC with permission and payment; BBMP said it does not give permissions — [Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/bescom-deadline-to-isps-triggers-internet-disruption-impacts-work-from-home-employees-2660088) [snippet]. Operators re-routed through buildings to avoid BESCOM's jurisdiction — [Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/deadline-missed-bengaluru-streets-still-tangled-in-illegal-cables-2672878) [snippet].
- Karnataka 2016 draft municipal rules barred communication cables from electric poles and allowed overhead only in exceptional cases — [Citizen Matters](https://citizenmatters.in/finally-govt-frames-rules-to-address-those-dangerously-dangling-cables/) [read; draft and old, final status unknown]. Telangana's northern DISCOM directed removal in Khammam — [Telangana Today](https://telanganatoday.com/cable-tv-internet-operators-in-khammam-told-to-remove-cables-from-electric-poles) [snippet].
- Puducherry scheme places installation risk on the operator — [Puducherry gazette](https://styandptg.py.gov.in/2018/DECEMBER/EXTRAORDINARYPART-II/1/69-PART-II%20No%2069%20dated%2011-12-2018.pdf) [snippet].

**Highways, trenches and ducts**
- 1.65 m depth with 0.45 m trench width appears in an NH project file — [MoRTH](https://morth.gov.in/sites/default/files/45410-01052022111017(1)(1).pdf) [snippet; fetched page empty]. Other permission files repeat 1.65 m, including HDD crossings. A separate NHAI checklist compares 1.65 m with a "0.6 m" requirement, with unclear labels [snippet from a search across MoRTH files; I could not tie this to one URL]. **I found no national DoT, TEC or BSNL norm that fixes this figure.** It is a repeated project practice, not a verified national rule.
- 2 m utility corridor at the edge of RoW where at least 45 m RoW is available, including OFC ducts — [MoRTH 2013 guidelines](https://morth.nic.in/sites/default/files/comprehensive_compendium_circular/145.22-07.08.2013-Guidelines%20for%20granting%20Right%20of%20way%20Permission%20to%20telecom%20service....%20%2807-08-2013%29.pdf) [snippet]. Earlier rule: cable at the edge of RoW or at least 15 m from centreline — [MoRTH 2000](https://morth.gov.in/sites/default/files/circulars_document/US-2000.09.29-Laying%20of%20Optical%20Fibre%20Cables%20in%20National%20Highway%20land%20for%20establishing%20telecom%20infrastructure%20by%20private%20licensees.pdf) [snippet]. A 2010 circular says cables and pipelines must be underground at the approved depth, which points to depth being set in each permission — [MoRTH 2010](https://morth.gov.in/sites/default/files/circulars_document/US-2010.09.21-Use%20of%20NH%20land%20for%20laying%20of%20Utilities%20including%20levying%20of%20appropriate%20fees.pdf) [snippet]. MoRTH's 22 Nov 2016 utility policy governs later permissions, with a 30-day public-comment step, but I could not read the circular — [MoRTH APSFL file](https://morth.nic.in/sites/default/files/1625%2020.5.2022%20APSFL%20OFC%20proposal%20at%2011.250%20for%20public%20comments_00001.pdf) [snippet].
- PLB HDPE duct: TEC generic requirement — [TEC GR copy on Scribd](https://www.scribd.com/document/482701104/TEC-GR-PI-CDS-008-04-AUG-19) [snippet; secondary copy]; RDSO specification — [RDSO](https://rdso.indianrailways.gov.in/uploads/files/2025-06-18-RDSO%20SPN%20TC%2045%202013%20Amdt%203.pdf) [snippet]. The RoW definition of duct covers lubricated pipe or other underground conduit — [Mondaq](https://www.mondaq.com/india/media-telecoms-it-entertainment/1528814/telecommunication-right-of-way-rules-2024) [snippet].

**Small ISP and LCO practice**
- AP Fibergrid: self-funded aerial on utility poles, 24-core ADSS, moving LCO/MSOs to local operator roles — [NCEG presentation](https://www.nceg.gov.in/assets/pdf/Plenary-3-AP-FIBERGRID.pdf) [snippet]. ADSS has a stronger jacket for direct aerial spans — [STL](https://stl.tech/blog/implementation-of-a-robust-fiber-deployment-process/) [snippet; vendor]. Vendor view: quicker to install and repair but more failures than buried — [Polycab](https://telecom.polycab.com/?p=34078) [snippet; vendor].
- National carriers use full GIS: Jio and Airtel — [TelecomTalk](https://telecomtalk.info/airtel-jio-gis-for-5g-airfiber-ftth/998215/) [snippet], [Esri Jio case](https://www.esri.in/content/dam/distributor-share/esri-in/pdf/industries/telecommunications/jio-case-study.pdf) [not read].

### Inferences
- **Treat every pole as a permission question.** Store owner, attachment permission reference, expiry and rent per pole. Pole rent is a recurring cost per pole, so an accurate count becomes money: a route of 1,000 poles at ₹300 is ₹3 lakh a year [calc].
- **Attachment to a DISCOM pole differs from a RoW for own pole.** The rules give ₹100 for a telecom line on street furniture, but state rates in the 2022 table are often higher. Whether the 2024 rate overrides them per DISCOM, and whether private DISCOMs (not yet notified as public entities as of the deck) are bound, needs legal confirmation. An app must not present either rate as the rule.
- **Eligibility.** Rules speak of an "authorised" provider. LCOs registered only with MIB may not fit cleanly, and their status should be confirmed. Do not assume.
- **Evidence is the operator's defence.** The BESCOM episodes suggest that having geotagged, dated photos and permission references per pole is useful when cutting drives occur. This is my inference, not a sourced outcome.
- **Under-ground records are an explicit legal duty; aerial records are not, per the slide wording.** Depth, duct count and as-built geometry should be first-class fields for duct routes, particularly because Rule 19 gives short deadlines to tell owners what lies under their property.
- **Depth field:** record observed depth as measured, with a "permit-specified depth" field beside it. Don't validate against a hard-coded 1.65 m.
- **Prominent disclaimer:** rates, rules and clearances vary by state and date. An app should store them as dated, editable reference data rather than constants.

### Gaps
- Could not read the official gazette GSR 576(E). The rule numbers above come from DoT slides, and the deadlines need confirming against the text. The Odisha PDF on DoT's site was unreadable without OCR.
- No current BESCOM pole-attachment process, form or rate found. No MSEDCL or TANGEDCO rates found. Telangana, Odisha and others date from 2022.
- No national trench or duct depth norm verified. MoRTH's 2016 circular and BSNL's OSP specification were not read.
- No first-hand account of LCO mapping practice. Coverage is largely of large carriers or state projects.
- Municipal permission practice after 2025 is unverified. Whether cities have aligned with the central rules is not established.

## Map data interchange: KML, GeoJSON, CRS, Google Earth habits

### Takeaway
KML and GeoJSON both use longitude then latitude in WGS84. Most interchange failures come from lat/lon swaps and lost attributes. KML is the expected currency in India: DoT's own PM GatiShakti mapping reportedly asks for KML or shapefiles.

### Cited Findings
- GeoJSON: coordinates are WGS 84 in decimal degrees (equivalent to `urn:ogc:def:crs:OGC::CRS84`), in "longitude and latitude ... precisely in that order". Other CRSs only by prior arrangement. Optional altitude is metres above the WGS 84 ellipsoid. Six decimal places is about 10 cm. Digit count does not indicate uncertainty — [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) [read].
- KML: longitude, latitude, altitude order, WGS84 horizontal; altitude in metres relative to the EGM96 geoid, default 0 — [Wikipedia on KML](https://en.wikipedia.org/wiki/Keyhole_Markup_Language) [snippet]. Google Maps shows latitude first, so values must be swapped when entering into KML — [Obdurodon tutorial](https://dh.obdurodon.org/kml/kml-tutorial.xhtml) [snippet]. The OGC KML 2.2 specification itself was not retrieved.
- DoT's PM GatiShakti mapping material asks optical fibre route owners to submit a KML or shape file with operator name, backhaul source, install date and core counts — [DoT/C-DOT document](https://dotws.cdot.in/sites/default/files/PM%20GatiShakti%20Nation%20Master%20Plan%20Mapping%20of%20optical%20fiber%20by%20IP-I%20registration%20holders.pdf?download=1) [snippet; fetch refused, addressed to IP-I registration holders].
- The Sanchar portal allows GIS mapping of street furniture or uploading a provider's own database, and has a route-distance tool — [DoT Overview of PM GatiShakti](https://eservices.dot.gov.in/sites/default/files/circular-notifications/Overview_of_PM_Gatishakti_compressed.pdf) [snippet].
- FBA: Shapefile is the recommended standard for survey deliverables; DXF/DWG and GeoJSON are also broadly compatible. Use FME or QGIS to reconcile coordinate systems — [FBA](https://fiberbroadband.org/resources/building-better-broadband-accelerating-designs-securing-permit-approvals-chapter-two-fielding-and-base-mapping/) [read].
- Google Earth appears alongside AutoCAD and MapInfo in Indian FTTH design CV-level sources only — [SlideShare profile](https://www.slideshare.net/slideshow/sandeep-kumar-67828555/67828555) [snippet; weak evidence].

### Inferences
- **EPSG:4326's formal axis order is latitude-first, while KML and GeoJSON are longitude-first.** Libraries differ, so test with a known point. In India a swap is usually easy to detect: valid latitude is roughly 6–38°N and longitude 68–98°E, so lat and lon do not overlap and an importer can auto-detect and warn [calc from general geography; not from a cited source].
- **Import rules for messy KML [RoT]:**
  - Accept KMZ and KML, plus folders as layers.
  - Expect the useful information to be in `name` and free-text `description`, not structured fields. Keep these verbatim, then offer mapping.
  - Do not assume a Placemark is a pole or that a LineString is a single cable. Ask the user.
  - Ignore or drop KML altitude unless needed; it is frequently 0.
  - Round to 6 decimals on export.
  - Never trust a KML line as measured length.
- **Export.** KML for sharing with Google Earth users and for government requests, GeoJSON for system integration, and possibly a shapefile/GeoPackage for GIS users. Remember shapefile limits such as 10-character field names [general knowledge, not sourced here].
- **Reproject in one place.** Store WGS84 lon/lat. Calculate length geodesically, not in degrees or Web Mercator, which inflates distances by a factor of about 1/cos(latitude): about 1.01 at 8°N, 1.15 at 30°N and 1.22 at 35°N [calc].

### Gaps
- No source describes actual Indian ISP KML habits in detail. "Google Earth KML is common" is widely asserted but I could not document it beyond DoT's format request.
- GatiShakti Sanchar KML schema or field specification not found. C-DOT document unreachable.
- Official OGC KML reference not read directly.

## Safety basics around electric poles

### Takeaway
Telecom cables run below power conductors and in the telecom space, and the operator typically carries liability. Sources give some figures, but the Indian clearances found are old and state-specific, so an app should convey basics and refer to the current DISCOM permit conditions, not state numbers as law.

### Cited Findings
- Cables on shared poles must be installed in the telecom space with clearance from electrical cables, including mid-span where sag reduces separation. ADSS in the power space only by qualified personnel. Cables must clear buildings, trees, other cables and traffic — [FOA](https://www.foa.org/tech/ref/OSP_Construction/Aerial_Workmanship.html) [read].
- Karnataka KPTC circular (reported 2004): cable at least 3.05 m above ground along roads, 5.8 m across roads; at least 1.2 m below LT; 1.8 m below 11 kV; always below power lines; tapping at least 2 m away from poles rather than at them. The 21 July circular came nine days after a child's death on 12 July, as the article reports — [Indian Television, 2004](https://indiantelevision.com/?p=191809) [read; over 20 years old, verify current values].
- CEA (Measures relating to Safety and Electric Supply) Regulations, 2023 govern safety for electric lines and installations — [PIB](https://pib.gov.in/PressReleasePage.aspx?PRID=1983088) [snippet]; full text — [KSEB-hosted CEA regulations](https://kseb.in/uploads/Downloadtemsuppy/Central%20Electricity%20Authority%20(Measures%20relating%20to%20Safety%20and%20Electric%20Supply)%20Regulations,%202023-1699594973944568556.pdf) [not read].
- Assam's utility states that cable wires on electric poles can cause electrical accidents — [Indian Television](https://indiantelevision.com/?p=131976) [snippet; the extract did not tie this quote to one URL, and it may be the linked GGCTOA/APDCL report above]. Puducherry puts risk on the operator — [gazette](https://styandptg.py.gov.in/2018/DECEMBER/EXTRAORDINARYPART-II/1/69-PART-II%20No%2069%20dated%2011-12-2018.pdf) [snippet]. BESCOM says providers will be held responsible for incidents — [Web Josh](https://webjosh.com/article/the-hindu-impact-bescom-sets-july-8-deadline-for-removal-of-illegal-cables-laid-on-its-infrastructure%C2%A0in-bengaluru-1720262164-4936) [snippet].
- A 2023 BESCOM notice followed a pole collapse injuring a student, so a pole's structural condition is itself a safety matter — [The News Minute](https://www.thenewsminute.com/article/internet-services-bengaluru-could-get-affected-bescom-orders-illegal-cable-removal-181534) [snippet].

### Inferences
General safety practice, not from a sourced India standard. Have a qualified safety person review before publication in an app.
- Mapping does not require climbing. Capture from the ground. Never climb or touch a pole to read a tag or marks.
- Treat every conductor and pole as live, including fallen wires, stay wires, and metal poles or transformers. Stay away from anything wet or in standing water.
- Do not survey on poles during rain or lightning. Do not raise ladders, rods or tape near overhead conductors.
- Do not touch cables that may be in contact with power lines, or poles with visible damage, sparks, burning smell or leaning. Report them to the DISCOM.
- Only trained, authorised people work on poles, with the DISCOM's permit/shutdown where required.
- Road safety is often the more immediate risk: use a vest, avoid standing in traffic for a photo, and do not operate the phone while riding.
- An app should record "hazard seen" as a report field and not encourage a closer look for a better photo or GPS fix.

### Gaps
- No current national clearance table for telecom cables on distribution poles was read. The CEA 2023 regulations full text was not reviewed.
- No reliable fatality data found for cable or ISP workers.
- No Indian DoT or industry field-safety guide specific to OFC workers found.
