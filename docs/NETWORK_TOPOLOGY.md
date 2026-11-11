# Network topology

**Network mapping Phase 14, 11 November 2026.** The logical layer (which service runs over which ONT, PON port and OLT, with its VLANs and profile) next to the physical layer (what the fibre links reach), and a topology screen built from recorded links instead of from equipment types.

## Two layers, kept apart

| Layer | Where it comes from | Code |
|---|---|---|
| Physical | The fibre links only: patches, ODF ports, splices, splitter inputs, outputs and cascades, drop fibres (Phase 12 `customerPathFromLinks`, the same source as the Phase 13 connection index). Never map position | `customerPath.ts`, `fiberIndex.ts` |
| Logical | What a person wrote about the service: service → ONT (`services.ontId`, else the customer's ONT) → the PON port the ONT is registered on (`onts.oltId`, `onts.ponPortId`) → OLT, plus the VLAN tags, profile, IP and circuit id on the service | `logicalTopology.ts` |

Neither layer is worked out from the other. When they disagree, both values are shown and the place is named. When the fibre links stop before a PON port, the port is "not decided" and nothing is compared.

## Where the logical values are stored

On the existing `services` record, as optional fields. No new collection and no SQL change.

| Field | Meaning |
|---|---|
| `vlan` | A single VLAN tag, 1 to 4094 |
| `sVlan`, `cVlan` | Outer and inner tags of a double-tagged (QinQ) service, 1 to 4094 each |
| `profileName` | The OLT's service or line profile name, as written |
| `ipAddress` | An IP address, or a note such as "PPPoE" or "DHCP", as written |
| `circuitId` | A circuit or service id from the office or an upstream provider, as written |
| `bindingRecordedAt`, `bindingRecordedBy` | When and by whom the values above were written |

The PON port an ONT is registered on stays on the ONT record (`oltId`, `ponPortId`), next to the OLT's address for it (`onuAddress`, as written, never converted).

**Why on `services` and not a new collection.** VLANs, profiles and IPs belong to one service: one ONT can carry internet on one VLAN and IPTV on another. A service already has one ONT, a status and a history, so a separate binding record would only repeat them and could drift from them. The registration belongs to the ONT, which already has those fields.

**Nothing is invented.** A value nobody recorded shows "Not recorded". The app never fills a VLAN, profile or IP, and no OLT is read yet, so every value is what a person typed. VLAN ids outside 1 to 4094 are refused by the record type (IEEE 802.1Q reserves 0 and 4095), in the browser and on the server, because no network can carry them.

## Rules (warnings only)

`findLogicalProblems` in `logicalTopology.ts`. Both are warnings: the person is asked first ("Save anyway") and saving anyway is written to the audit trail as `WARNING_ACCEPTED`. Nothing here is ever refused, because a wrong rule must never stop field work.

| Code | When |
|---|---|
| `service_pon_mismatch` | An ONT with a live service is recorded as registered on one PON port, but its fibres reach another. The message names both ports and the services. The ONT's own drop fibre decides where it is plugged in; without one, its recorded splitter output; without that, its customers' links (only when they all agree) |
| `vlan_twice_on_pon` | Only when the setting `logical.vlanUniquePerPon` is on. Two or more live services on one PON port carry the same tag (or the same S-VLAN and C-VLAN pair). The port is the ONT's registration, else the one its fibres reach; a service on neither is not compared |

**The setting** `logical.vlanUniquePerPon`, "Each VLAN may be used by only one service on a PON port", is **off by default**. Many operators give every customer on a port the same internet VLAN (N:1, often with PPPoE), so a repeated VLAN is normal there. Turn it on only when the OLT gives each customer their own VLAN (1:1). It is stored in the `settings` collection with its source and who changed it, and is shown with its reason under "Rules used for service settings" on the Physical and logical tab. Only accounts with the `configure` right can change it.

The warnings are asked when the binding or the registration is saved on the Topology screen (`saveServiceBinding`, `setOntRegistration`). Other commands (moves, ONT swaps, splices) do not ask about them; the disagreement then shows on the Topology screen and in the count of "things to check across the network".

## Combined view

`combinedView(data, target)` for an OLT, a PON port, a splitter or one customer. A customer is listed when the fibre links reach the target, or when anything recorded about them names it (the customer's path fields, the ONT record). So a customer whose ONT says PON 2 while the fibres reach PON 1 is listed under both ports, with the disagreement.

For each customer, side by side (stacked on a phone):

- **From the fibre links:** OLT, PON port, feeder cable, distribution cable, box, splitter output, drop fibre, and every missing link in words.
- **Service settings as recorded:** the ONT, the port it is registered on, the OLT's address for it, the splitter output on the ONT record, and for each live service the VLAN (or S-VLAN and C-VLAN), profile, plan, IP, circuit id, ONT port, and who and when.
- **Where they disagree:** PON port, splitter output, drop fibre, a service naming another ONT, a VLAN used twice. Marked ✕ with words, never colour alone.

The older `plan` and `ipAddress` fields on the customer record are shown apart, "as written".

## Topology screen

**Topology** in the sidebar (`apps/web/src/features/topology/`). The older picture that grouped equipment by type, with made-up port counts and losses and no real connections, is gone. Three tabs:

1. **Network tree.** OLT → PON port → splitter (with the box it sits in) → outputs → cascaded splitters → ONT → customer, built only from recorded links (`serviceTopology`). Each OLT, PON port, splitter and output says what is below it ("2 customers · 2 ONTs · 1 splitter · 1 missing link"). A link that is not recorded shows in red with ✕ and its name, in its place. Customers and splitters no PON port reaches are listed apart with the first missing link. **Show services and VLANs** turns the logical layer on: services with their binding, the ONT's registration, and ✕ "Does not match" where the ONT record names another port than the links come from. Tapping a line offers **Show on map** and **Physical and logical**. It is a folding list with Open all and Close all, not a canvas, so it reads at 390 px; every control is at least 48 px tall on a phone.
2. **Physical and logical.** Choose an OLT, PON port, splitter or customer (or come from the tree). Shows the combined view above. **Change service settings** records VLAN, S-VLAN, C-VLAN, profile, IP and circuit id (digits only for VLANs; an empty box means "Not recorded"). **Change registration** records the OLT and PON port the OLT shows the ONT on, or "Not recorded". Both buttons are offered only to accounts with the `edit` right; the app and the server check the exact right of the change again, as for every write.
3. **Readings and lengths.** Unchanged (expected against measured light, and cable lengths).

## Personal data and organisations

- The screens read the network on this device, which the server has already limited to the person's organisation (Phase 23b) and redacted for their role (Phase 12). Nothing extra is fetched.
- A customer whose name is hidden for the role is shown as "Customer CUST-7 (name hidden for your role)", never as a list of "Hidden for your role". A hidden unit (flat number is part of the address) is left out of the tree. The binding (VLAN, profile, IP, circuit id) is not personal data under the Phase 12 table, like the other link fields, so it is shown to every role that can see the service.
- Warnings name customers the same way, so a message never carries a name the role may not see.

## Files

| Part | Files |
|---|---|
| Logical layer, rules, combined view, commands | `packages/shared/src/domain/logicalTopology.ts` |
| Tree from the links (counts, box, logical layer, mismatch) | `packages/shared/src/domain/serviceTopology.ts` |
| Record type | `packages/shared/src/model/schemas.ts` (`serviceSchema`) |
| Screens | `apps/web/src/features/topology/NetworkTopologyView.tsx`, `ServiceTopologyPanel.tsx`, `CombinedViewPanel.tsx`, `topologyUi.ts` |
| Store actions | `apps/web/src/stores/logicalActions.ts` |
| Tests | `packages/shared/test/logicalTopology.test.ts`, `apps/web/src/features/topology/topology.test.tsx`, `apps/server/test/phase14logical.test.ts` |

## Known gaps

- **No OLT is read.** Every logical value is typed by a person. A device-reported binding (from an OLT export or NMS) needs a monitoring adapter (Phase 7 gap, `docs/MONITORING_ADAPTERS.md`); the ONU address is still not converted into a port.
- The server does not run the logical warnings: like every warning in FiberGIS, they never block, so the server only checks the record type (VLAN range). A write through the API does not ask.
- Moves, swaps and splice changes do not ask about the logical warnings; the Topology screen shows the result.
- The VLAN rule has one scope, the PON port. Per-OLT or per-uplink uniqueness, GEM ports, T-CONTs and bandwidth profiles are not modelled.
- Cable TV (HFC) customers are not on a PON port and are left out; the Cable TV page shows their tree.
- Customers with no ONT record (older records with only a serial) have no registration, so their port is "Registration on the OLT not recorded".
- The screens are English only, like the other engineer screens.
