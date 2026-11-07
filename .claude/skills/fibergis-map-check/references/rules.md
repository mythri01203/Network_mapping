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
| `possible-duplicate` | Same type within 2 m | Proposed; phone GPS error is about 5 m, so closer real items are possible but rare |
| `points-to-deleted` | A fault or work order refers to something deleted | Integrity, but kept as history, so not blocking |

The Rx rules assume class B+. C+ ports need different limits, which the data does not currently record.

## Good to know

| Rule | Meaning |
|---|---|
| `default-name` | Still called "New ..." |
| `not-connected` | Non-pole equipment with no cable, splitter or customer |
| `stacked-pins` | Different types of the same category on one spot, so one hides the other |

A box on a pole at the same spot is normal and is not flagged, because poles are in a different category.

## Ideas not yet built

Mostly blocked by the data model:

- Whole-path core continuity through splices
- Loss budget in both directions per PON
- Spread above 15 dB or 20 km on one PON
- Split-ratio product limits
- Duct occupancy
- Expired permissions
- RF rules (`fibergis-cable-tv-mapping`)
