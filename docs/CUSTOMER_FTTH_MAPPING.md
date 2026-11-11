# Customer and FTTH mapping

Phase 12 (Module 13). How FiberGIS knows where a customer is connected, how it stops that from being recorded wrongly, how old records that disagree are fixed, and who may see a customer's personal data.

## The short version

- **The fibre links decide where a customer is connected.** The customer's drop fibre, then back through splices to a splitter output, then from that splitter's input through splices, cascades, ODF ports and patches to an OLT PON port.
- The customer's path fields (OLT, PON port, feeder cable, distribution cable, box, splitter, output, drop cable, drop fibre) are a copy of that. They must agree with the links.
- **A write that makes them disagree is refused** as broken data, on the server and in the app. A blank field is "not recorded" and is never refused. Where the links stop, the fields after that point are not checked and are never filled in for you.
- **Old records that already disagree are not blocked and not rewritten.** Customers → **Check customer paths** lists them with the fix taken from the links. A person ticks the ones to fix and confirms. Each change is written in the customer's history and the audit trail.
- **A splitter output's customer** (`connectedCustomerId`) must agree with the customer its fibre leads to, with the same check and the same fix screen.
- **Personal data by role.** Name, address, house position (GPS) and mobile are left out of every server answer for roles that do not need them. The app shows "Hidden for your role". A hidden value is never saved back.

## Where the path comes from

`packages/shared/src/domain/customerPath.ts`, `customerPathFromLinks`.

| Field | Worked out from | Known when |
|---|---|---|
| Drop cable, drop fibre | The customer's own drop fibre. Without one, the single splitter output that names the customer and carries a fibre | Always, if recorded |
| Splitter, output | The first splitter output reached going back from the drop fibre, through any splices | The drop fibre's feed is recorded |
| Box | The box the splitter is installed in | As above |
| Distribution cable | The cable that feeds the splitter's input (for a cascade, the parent splitter's input cable) | The splitter input is linked to a fibre |
| OLT, PON port | The PON port reached through splices, cascades, an ODF port and its patch, or straight onto a feeder fibre | The links reach a PON port |
| Feeder cable | The cable at the OLT end | The links reach a PON port |

Rules the walk follows:

- Only recorded links count. Never position, nearness, or which cable happens to end at the box.
- A fibre with no feed, or with two feeds, stops the walk. The message names that fibre.
- A planned splice still links its two fibres (it already claims them). Damaged or faulty marks do not change where a link goes.
- A customer straight on an ODF or PON port (no splitter) gets the OLT and PON port only.
- Cable TV customers (`accessNetwork: 'hfc'`) and disconnected customers are not checked.
- One walk per splitter per check, so many customers on one splitter cost one walk.

The same convention is used everywhere a path is stored: provisioning (`provisionCustomer`), relinking, moving (`moveCustomer`, which now takes its OLT side from this walk), and linking a drop from the connect screen (`linkCustomerDrop`).

## What is refused, what is a warning

| Case | Result |
|---|---|
| A customer write whose OLT, PON port, feeder, distribution, box, splitter or output differs from what the links say | Refused: "Broken data: Asha is recorded on OLT OLT-2, but the fibre links lead to OLT-1." Nothing is saved |
| A splitter output write that names a customer its fibre does not lead to, or a customer not on record | Refused: "Broken data: Output 2 of splitter SPL-1 is recorded for Ravi, but its fibre leads to Asha." |
| A customer write that moves them away while their old output still names them | Refused (the output now disagrees) |
| A new customer whose chosen OLT, PON port or cable the links contradict | Refused in the wizard: "you chose OLT OLT-2, but the fibre links from SPL-1 lead to OLT-1" |
| A blank field the links could fill | Listed in Check customer paths as "Not recorded". Never refused |
| A field past where the links stop | Not checked. It may be blank or keep what a person chose |
| A disagreement already stored, written again unchanged (for example a light reading on that customer) | Accepted. It stays on the fix list |
| A link change (a splice, a splitter input) that makes stored customers disagree | Accepted (field work is never stopped by a customer record). The customers appear on the fix list |
| Two records disagree and no fibre link settles it (an output names a customer whose own record names another output, and neither has a fibre) | Listed under "Check on site", with no fix offered |

Where it runs:

- Server: `checkChangeSetConnections` in `packages/shared/src/domain/connectionRules.ts`, called by the link guard (`apps/server/src/lib/linkGuard.ts`) for every write that stores a customer or a splitter. The guard now also reads closures, so splices are followed.
- App: `checkedConnectionChange` in `connectionCommands.ts` runs the same check on every customer and connection command, so the refusal is the same before anything is sent.
- Only "disagrees" blocks, and only for a record the write stores, and only when the stored data did not already have that exact disagreement (`newCustomerPathDisagreements`).

## Fixing records that disagree

Customers → **Check customer paths** (`apps/web/src/features/customers/CustomerPathCheck.tsx`). Shown to roles with the edit right.

1. The list shows each customer with what does not match, or is not recorded, and what the links say.
2. Tick the customers to fix (each row is a 48 px tap target), or **Choose all**.
3. **Fix chosen from the links**, then confirm.

`reconcileCustomerPaths` (shared) then:

- Sets each listed field to the value from the links. Fields the links do not decide are left as they are.
- Names the customer on a splitter output whose fibre leads to them (and marks a free output Occupied), or clears a customer the output's fibre does not lead to (an output with no fibre left goes back to Available).
- Recounts the PON customer counts of the old and new OLT from the customer records.
- Writes a history line on each customer (`PATH_FROM_LINKS`, "OLT OLT-2 → OLT-1; PON port not recorded → PON-01") and on each output (`OWNER_FROM_LINKS`), and one audit entry per customer (`CUSTOMER_PATH_FROM_LINKS`).
- Runs the normal checks, so the server judges it like any other write.

Nothing is changed by opening the screen, by the map check, or by any automatic step.

## The customer wizard

`apps/web/src/features/customers/CustomerWizardModal.tsx`.

- Phase 0B behaviour is kept: the person chooses the box, the splitter, the output and which fibre of the new two-fibre drop carries the service. Nothing is preselected.
- Before saving, **"Path from the fibre links"** shows the path step by step: OLT and PON port, each cable, the cable into the splitter, the box, splitter and output, the new drop fibre, the house. A part the links do not give says "Not recorded" in amber, and where the links stop it says so.
- Saving with an incomplete path still asks "Save with missing details?" as before.

## Personal data by role

Rules: `CUSTOMER_PRIVACY` in `packages/shared/src/domain/customerPrivacy.ts`. Roles are the Phase 23a roles.

| Role | Name | Address | House position | Mobile | Why |
|---|---|---|---|---|---|
| Super Admin, Network Admin | Shown | Shown | Shown | Shown | Run the business |
| Network Planner | Shown | Shown | Shown | Shown | Owns customer records |
| NOC Operator | Shown | Shown | Shown | Shown | Phones customers about outages |
| Supervisor | Shown | Shown | Shown | Shown | Gives out jobs |
| GIS Engineer | Shown | Shown | Shown | Hidden | Mapping needs the house, not the phone |
| Field Technician | Own open jobs only | Own open jobs only | Shown | Own open jobs only | Needs the map; the drop is drawn to the house anyway |
| Read-only | Hidden | Hidden | Hidden | Hidden | Looks only |

- "Own open jobs": work orders whose technician name is the person's display name (the same "own" the write check uses), not Cancelled or Closed, naming the customer.
- Address covers `address`, `building` and `flatNumber`. House position covers `lat`, `lng`, accuracy and method.
- Links are not personal: ids, path fields, ONT, readings and plan stay.
- The customer names copied elsewhere are hidden the same way: `connectedCustomerName` on splitter outputs, `customerName` on cable fibres, and an assignment's "ONT of <name>".
- Setup mode (login off, server computer only) sees everything, as every other rule.

**How it looks in an answer.** Text fields become "Hidden for your role". A hidden house position becomes 0, 0 and the record carries `hiddenFields: ['name', 'address', 'mobile', 'gps']` (only what was actually hidden). The app reads `hiddenFields`, so a hidden position shows "House position: Hidden for your role", never "House location not recorded", and the map pin and "locate" button are not offered.

**Every answer that carries customers** (`apps/server/src/auth/access.ts`):

| Route | What is done |
|---|---|
| `GET /network` | Customers, splitters, cables and sync conflicts redacted. Own jobs read from the snapshot |
| `GET /network/area` | The same; own jobs read from the stored jobs (they may be outside the box) |
| `GET /changes?since=` | The same for the changed records |
| `GET /<collection>`, paged or not, and `GET /<collection>/<id>` | Each record redacted |
| `PUT /<collection>/<id>` | Answers with the stored record as the role may see it |
| `GET /revisions/...` (list item, one version, compare) | Each version redacted before it is compared, so no value leaks through the differences |
| `GET /audit-events` (JSON and CSV) | Read-only: field names only, as before. Other roles: the values of the personal fields they may not see are left out (and the splitter output and fibre lists, which carry names, for roles that do not see names) |
| `GET /change-requests/<id>` and every change request step's answer | The records in the request are redacted |
| Sync conflicts | Read-only gets none (as before). Others get the copies redacted |
| `GET /reports/data-quality` | Unchanged: it sends only rule names, counts and ids |
| `GET /search` (Phase 16) | Uses the same `redactForViewer` |

**A hidden value is never saved** (`restoreHiddenPersonalData`). On `POST /changes`, `PUT /<collection>/<id>`, `POST /change-requests` and applying a request, any customer, splitter output, fibre or sync conflict that comes back with "Hidden for your role", or a hidden position as 0, 0, keeps the stored value, and `hiddenFields` is taken off. A value the writer really changed is kept, so the permission check still judges it (a technician who retypes a name is refused as before). So a technician can record a light reading on a customer they cannot see the name of.

## Tests

| File | What it proves |
|---|---|
| `packages/shared/test/customerPath.test.ts` (15) | The path worked out through a splice; nothing decided past a gap; disagreement and blank listed; refusals for a wrong OLT, splitter, box and output owner; a stored disagreement written again is accepted; reconcile only for the chosen customers with history; owner set and cleared from the fibre; linking a drop; a wizard draft the links contradict is refused; the sample network has no disagreement; privacy rules per role, own jobs, restore of hidden values |
| `apps/server/test/phase12.test.ts` (6) | Mismatched path refused through `POST /changes` and `PUT`; output owner refused; personal data per role in the snapshot, the map area, the changes feed, the collection list, paged list, one record, a splitter, revisions, compare, audit events and change requests; a technician's light reading on a redacted copy keeps the real name, mobile and address |
| `apps/web/src/features/customers/customerPaths.test.ts` (2) | Fixing from the links in the app store, only after the call; the hidden house position text |

## Known gaps

- Free text can still hold a name: audit trail details written by older commands, job notes, fault descriptions, history lines. Only structured fields are hidden.
- A phone that cached the full network before this change keeps that copy until its next full load.
- A technician's own jobs are matched by display name, as the Phase 23 write check does. Two people with one display name would share them.
- The `fibergis-map-check` skill does not list path disagreements yet; Check customer paths does.
- Monitoring answers (ONU statuses, readings) name customers by id only and were not changed.
- Customers sharing one ONT (an MDU unit) share one output; the owner check accepts any of them on that output.
