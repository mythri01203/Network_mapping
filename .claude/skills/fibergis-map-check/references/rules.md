# Checker rules

Basis: **Physics** (cannot be otherwise), **Integrity** (the data contradicts itself), **Standard** (G.984.2), **Proposed** (judgement; change freely).

## Must fix

| Rule | Meaning | Basis |
|---|---|---|
| `cable-end-missing` | A cable end points to something that does not exist | Integrity |
| `coordinates-swapped` | Latitude and longitude look swapped (uses India's ranges) | Integrity |
| `core-count-wrong` | Cable says N cores but has a different number of records | Integrity |
| `core-number-repeated` | The same core number appears twice in a cable | Integrity |
| `splice-cable-missing` | A splice uses a cable that does not exist | Integrity |
| `splice-core-missing` | A splice uses a core beyond the cable's size | Physics |
| `core-spliced-twice` | One core is spliced twice on the same side in a closure | Physics |
| `splitter-box-missing` | A splitter belongs to a box that does not exist | Integrity |
| `splitter-loss-impossible` | Recorded loss is below ideal `10·log10(N)` by more than 0.1 dB (allows rounding) | Physics |
| `splitter-port-repeated` | A splitter lists the same port twice | Integrity |
| `splitter-port-missing` | A customer uses a port the splitter does not have | Integrity |
| `splitter-port-shared` | Two customers are on one splitter port | Physics |
| `splitter-port-disagrees` | Customer and splitter disagree about who is on a port | Integrity |
| `splitter-customer-missing` | A port points to a customer who does not exist | Integrity |
| `splitter-input-missing` | A splitter's input cable does not exist | Integrity |
| `customer-link-missing` | A customer points to an OLT, box, splitter or cable that does not exist | Integrity |
| `core-shared` | Two customers use the same core of one house wire | Physics |
| `span-end-missing` | A span names a pole or structure that does not exist | Integrity |
| `span-same-ends` | A span starts and ends at the same pole | Integrity |
| `attachment-cable-missing` | An attachment names a cable that does not exist | Integrity |
| `attachment-host-missing` | An attachment's pole or span does not exist, or it names both or neither | Integrity |
| `duct-end-missing` | A duct starts or ends at something that does not exist | Integrity |
| `duct-cable-missing` | A duct lists a cable that does not exist | Integrity |
| `duct-cable-repeated` | One cable is listed twice in one duct (duct or sub-ducts) | Physics |
| `slack-cable-missing` | A slack loop is on a cable that does not exist | Integrity |
| `slack-place-missing` | A slack loop's pole or chamber does not exist | Integrity |
| `slack-length-invalid` | A slack loop has no usable length | Integrity |
| `permission-item-missing` | A permission covers a pole or cable that does not exist | Integrity |
| `core-two-feeds` | One fiber is fed from two places (splices, splitter outputs, ODF ports, PON ports). Splices out of service are history and not counted | Physics |
| `core-two-continuations` | One fiber goes two ways on its customer side (splices, splitter inputs) | Physics |
| `core-two-assignments` | One fiber has two active assignments | Physics |
| `tube-layout-wrong` | Tubes x fibers per tube does not equal the fiber count | Integrity |
| `splitter-output-overflow` | A splitter lists an output beyond its ratio | Physics |
| `splitter-input-core-missing` | A splitter input names a fiber the cable does not have | Integrity |
| `odf-port-core-missing` | An ODF port names a feeder fiber that does not exist | Integrity |
| `odf-patch-missing` | An ODF port is patched to an OLT or PON port that does not exist | Integrity |
| `pon-two-patches` | One PON port is patched to two ODF ports | Physics |
| `ont-link-missing` | An ONT record (not removed) names an OLT, PON port, splitter, drop cable or fiber that does not exist | Integrity |
| `ont-serial-twice` | One serial is on two ONT records that are not removed (spaces and case ignored) | Integrity |
| `ont-one-customer-shared` | An ONT recorded for one customer is used by several. A shared (MDU) ONT may serve several | Integrity |
| `customer-ont-missing` | A customer names an ONT record that does not exist | Integrity |
| `customer-on-removed-ont` | An active customer is on an ONT that was removed (swapped out) | Integrity |
| `customer-building-missing` | A customer names a building, or a unit, that does not exist | Integrity |
| `service-customer-missing` | A service names a customer who does not exist | Integrity |
| `service-ont-missing` | A live service names an ONT that does not exist | Integrity |
| `building-link-missing` | A building's entry pin, riser cable, floor box pin or floor box splitter does not exist | Integrity |
| `unit-box-missing` | A unit names a floor box its building does not have | Integrity |
| `alarm-device-not-connected` | An alarm claims to come from the OLT, but no OLT is connected (Phase 7 not built) | Integrity: it cannot be real |
| `alarm-test-label` | A TEST event not marked TEST, or a real alarm marked TEST | Integrity |
| `fault-closed-unverified` | A fault verified or closed with no check (field light reading with meter photo, photo, or office check), on itself or one of its jobs | Integrity: the app and server refuse it since Phase 8 |
| `work-order-closed-unverified` | A work order verified or closed with no complete check | Integrity |
| `verification-incomplete` | A check is missing what makes it count: a reading not marked field measured, no meter photo, no photo, no note | Integrity |
| `fault-test-mixed` | TEST and real alarms in one fault, or a real job on a TEST fault | Integrity |

## Check these

| Rule | Meaning | Basis |
|---|---|---|
| `cable-end-not-connected` | A cable end has no equipment | Proposed; may be work in progress |
| `cable-end-far` | Cable end is over 50 m from what it connects to | Proposed |
| `cable-no-route` | No line on the map | Proposed |
| `cable-length-mismatch` | Map and saved length differ over 10% | Proposed; slack and corners are normal |
| `splitter-port-count` | Port count does not match the ratio | Proposed |
| `splitter-no-input` | No incoming cable recorded | Proposed |
| `customer-path-incomplete` | A customer's path has blanks | Proposed |
| `customer-pon-unknown` | PON port not on that OLT | Proposed; addressing varies by vendor |
| `rx-looks-fake` | 0 dBm, which the app saves when it has no reading | Known app behaviour |
| `rx-too-strong` | Above −8 dBm | Standard (B+ overload) |
| `rx-too-weak` | Below −27 dBm | Standard (B+ sensitivity) |
| `made-up-serial` | ONT serial looks auto-generated | Known app behaviour |
| `same-name` | Same type and name on several items | Proposed |
| `possible-duplicate` | Same kind within 2 m (any pole counts as the same kind as another pole) | Proposed; phone GPS error is about 5 m, so closer real items are possible but rare. The app asks "same one?" at 5 m (`osp.duplicate.radiusMeters`); this check is stricter on purpose |
| `span-proposed` | Spans only proposed from the field order, waiting for the office | Known app behaviour: "Next pole" records order, not proof of a line |
| `span-repeated` | Two spans join the same two poles | Proposed |
| `attachment-repeated` | The same cable is recorded twice on one pole or span | Proposed |
| `attachment-far-from-route` | A pole recorded as carrying a cable is over 30 m from its drawn line | Proposed; either the line or the record is wrong |
| `permission-expired` | A permission's recorded end date has passed | As recorded; check the paper, not a legal judgement |
| `points-to-deleted` | A fault or work order refers to something deleted (including a fault naming a deleted alarm) | Integrity, but kept as history, so not blocking |
| `alarm-points-to-missing` | An open alarm is about an element that is not on record | Integrity, not blocking: clear it or fix the record |
| `fault-affected-missing` | An open fault lists affected customers no longer on record | Integrity |
| `fault-affected-broken-path` | An open fault lists affected customers whose path is now broken (no house wire or fiber recorded, the wire is gone, or disconnected), so the list was built from a path that no longer holds | Proposed: open "Who is affected now" in the app before calling customers |
| `work-order-open-on-closed-fault` | A work order is still open while its fault is verified or closed | Proposed |

The Rx rules assume class B+. C+ ports need different limits, which the data does not currently record.

## Good to know

| Rule | Meaning |
|---|---|
| `default-name` | Still called "New ..." |
| `not-connected` | Non-pole equipment with no cable, splitter or customer |
| `stacked-pins` | Different types of the same category on one spot, so one hides the other |
| `aerial-no-poles` | An aerial cable with no poles recorded, so nobody can answer which poles carry it |
| `cable-scheme-unknown` | A cable joined fiber by fiber has no colour scheme, so colours are not shown ("Blue may not be fiber 1") |
| `pon-class-not-recorded` | A PON port in use has no optics class, so budgets assume one |
| `odf-port-half` | An ODF port has a patch but no feeder fiber, or the other way round |
| `splice-planned` | A splice is recorded as planned, not done; traces stop there |
| `splice-loss-origin` | A splice loss with no recorded origin, so not known to be measured |
| `ont-installed-unused` | An ONT is marked installed but no customer uses it |
| `ont-only-on-customer` | Once ONT records are in use: customers whose ONT serial is written only on their own record, so a swap would leave no history |
| `disconnect-no-history` | A customer is disconnected with no reason or earlier connection recorded (older data) |
| `building-riser-not-recorded` | A building with units has no riser cable, so the path to its units cannot be followed |
| `unit-box-not-recorded` | Units with no floor box recorded |
| `fault-resolved-before-checks` | Faults marked "Resolved" before checks existed (older records), so nothing shows the repair was verified |
| `work-order-awaiting-check` | Repair done, no check yet |
| `sync-conflicts-waiting` | Records changed by two people at once, waiting for a choice (Operations, Changed twice); both versions are kept |

A disconnected customer has no path by design, so the customer path rules skip them. Customers on one shared ONT may use one drop fiber; `core-shared` is not raised for them.

A box on a pole at the same spot is normal and is not flagged, because poles are in a different category.

## Ideas not yet built

Mostly blocked by the data model:

- Whole-path core continuity, loss budget per direction, spread on one PON and split-product limits: built in the app (`packages/shared/src/domain/fiberRules.ts` with `trees: true`, and the trace screen); not repeated in this standalone script, which checks each link
- Span length against a measured length, and long spans
- Slack expected on long aerial routes (no sourced rule exists; see `fibergis-osp-mapping`)
- RF rules (`fibergis-cable-tv-mapping`)
- Whether a fault's suspected element really explains its alarms: the app works this out from core-level paths (`correlateAlarms`); this script only checks the stored affected list against each customer's own record
