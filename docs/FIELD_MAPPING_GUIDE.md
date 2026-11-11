# Field survey and offline mapping

**Phase 19, 11 November 2026.** This guide adds to [FIELD_WORKER_GUIDE.md](FIELD_WORKER_GUIDE.md). Read that one first: it explains every phone step (add a pole, a box, a drop, a light level, danger, jobs). This one only covers what is new: the office review of phone captures, inspection checklists, barcodes, the office's offline copy and the sync history.

## For field staff (read aloud)

**Nothing you do on the phone changes.** Three small things are new:

1. **After saving a pole, box or house wire,** the phone says **Saved on phone** and then **The office will check it, then it goes on the network map.** That is normal. Keep working. The office looks at your photo and accepts it.
2. **Tags:** the scanner now reads **QR codes and barcodes** (the striped kind). Hold the phone so the whole tag is inside the white frame. The code it read is shown under **Tag read**, so you can check it.
3. **What was sent:** on the first screen, tap **What was sent**. You see a list, newest first:
   - a tick and **Sent**: the office has it;
   - a cross and **Not accepted**: the office's reason is shown. **It stays on the phone. Call your supervisor.**
   - two arrows and **Someone else changed it too**: you and the office changed the same thing. Nothing is lost; see "Someone else changed this" in the worker guide.

**Undo** still works right after saving. Once the office has accepted or rejected an item, only the office can change it. Call the office if it is wrong.

The new Telugu and Kannada words are **drafts**, like all the others, until a native speaker and crews check them ([LANGUAGE_REVIEW.md](LANGUAGE_REVIEW.md)).

## For the office

### The review queue

Open **Operations**, then **Field captures**. The top list is **Waiting for office review**. Every pole, box and house wire captured on a phone waits here. Until it is accepted it is **not part of the network**: its status is Planned and the map draws it as a **dashed violet ring with a clock** (Layers, Legend: "Phone capture awaiting office review").

Each item shows:

| Shown | Where it comes from |
|---|---|
| Photo | The phone's photo, once it has reached the server. Before that: "Photo not at the office yet" |
| Captured when and by whom | The GPS reading time and the person the phone was logged in as |
| GPS | "within about N m" (the phone's median accuracy), "No GPS fix: the office must place it", or "GPS accuracy not recorded" |
| Tag | The code scanned, or "No tag scanned" |
| Answers | Owner kind and material as tapped on the phone, and the customer the worker named for a drop |
| Maybe the same one as | Items of the same kind within the phone's own "same one?" distance (1.5 × accuracy + 5 m, Administration, Field capture settings), and items with the same tag. **Only a hint**: compare the photos |

What you can do:

- **Show on map** opens it, so you can check the place against the photo, or place it (**Move this item**) when it has no GPS fix.
- **Accept**: it becomes a normal record, status Active, with who accepted it and when. An item with no GPS fix asks first: place it, or accept anyway with a reason. The reason is kept on the record and in the audit trail.
- **Reject**: write why (or tap a common reason, such as "Same as an item already on the map"). It stays on record with your reason, but is taken off the map and out of the "same one?" checks and the place-or-check list. Nothing is deleted.
- **Show rejected captures**, then **Put back in the queue**, undoes a rejection made by mistake. The audit trail keeps both decisions.

Who decides: Super Admin, Network Admin, GIS Engineer and Network Planner. Field Technicians, NOC Operators, Supervisors and Read-only accounts can see the queue but not decide. The server refuses a technician who tries to accept, or to change or undo an item the office already decided.

Not held back for review: **danger reports** (they must reach the office at once, as faults) and **light readings** (already marked "measured on site" with the meter photo). Jobs work as before.

The older **Field captures to place or check** and **Spans to confirm** lists are unchanged and sit below the queue.

### Inspection checklists

Every inspection form (pole, manhole or handhole, span, duct, and now **box or closure**: FAT, FDT, joint closures) shows a checklist. Each item has three big buttons: **OK**, **Problem**, **Could not check**. Tap again to clear. Nothing is answered for the person: an item left alone is not stored, and later reads "not recorded". The answers are saved on the inspection with the words as they were shown, so renaming an item later does not change old inspections. The inspection list shows "Checklist: 5 answered, 1 problem" with the details.

Box inspections are on the box's **Maintenance** tab.

Change the lists in **Administration, Lists and rules, Inspection checklists**. The starting items are a proposal from the outside-plant checks, not a standard. As with the other lists, built-in items can be renamed or hidden but not removed, and you can add your own. The server checks every change.

### The office's offline copy

The office's copy of the network on each computer or phone is now kept in **IndexedDB**, not in the browser's small 5 MB `localStorage`. Nothing to do:

- The first time the new version opens, it moves the copy over by itself. Anything still waiting to be sent moves with it, and is removed from the old place only after the new place has stored it.
- The network and the list of changes not yet sent are always stored together, in one step, so they cannot disagree after a crash or a reload.
- If the device runs out of space, the sync menu says **Not saved on phone** and a message says **Phone storage is full**. Other storage failures say **Not saved on this device**. Stay connected until the changes reach the server; the app keeps trying every 15 seconds and with every new change.
- If IndexedDB cannot open at all (some private windows), the app keeps working exactly as before, on `localStorage`.

How sending works has not changed (see [API_DOCUMENTATION.md](API_DOCUMENTATION.md), `POST /changes` and `GET /changes?since=`).

### Sync history

The cloud button at the top right has a new item: **Sync history on this device**. It lists, newest first, what this device sent, when, and the answer: **Sent**, **Refused** with the server's reason, or **Changed elsewhere too** (a conflict, kept for a person to choose). Photos sent by the phone capture flow are listed too. Filter by result at the top.

The history belongs to the device: it is kept with the offline copy, for 30 days and at most 300 lines, and never sent to the server. Another computer shows its own list. It names records (customers too), so a logout on a shared device that clears the stored network clears it as well. For the whole team's record of changes, use the audit trail and record history.

## Technical notes

| Area | Where |
|---|---|
| Review statuses and commands | `packages/shared/src/domain/fieldReview.ts`: `fieldReviewQueue`, `acceptFieldCapture`, `rejectFieldCapture`, `reopenFieldCapture`, `isAwaitingReview`, `isInProduction` |
| Record fields | `equipment.reviewStatus` (`awaiting_review`, `accepted`, `rejected`), `reviewedAt`, `reviewedBy`, `reviewReason` (`schemas.ts`, JSON fields, no SQL change) |
| New captures | `buildCapturedEquipment` (`fieldCapture.ts`): status Planned, `reviewStatus: 'awaiting_review'` |
| Server rule | `checkChangeAccess` (`access.ts`): a technician cannot set a decided review, change review fields, or change or delete a decided capture |
| Checklists | `packages/shared/src/domain/inspectionChecklist.ts`, settings `checklist.<target>`, checked by `ruleSettingProblem` and the server's `settingsGuard`; answers in `inspection.checklist` |
| Barcodes | `apps/web/src/features/capture/qrScanner.ts`, `TAG_BARCODE_FORMATS` (the bundled zxing-wasm decoder; no new dependency) |
| Offline copy | `apps/web/src/lib/officeCache.ts` (database `fibergis-office`, store `cache`), started in `main.tsx` before the store loads (`boot.tsx`) |
| Sync history | `apps/web/src/stores/syncHistoryStore.ts`, written by `syncEngine.ts` (sent, refused, conflict) and the capture service (photos) |
| Screens | `features/field-review/` (queue, item banner, checklist editor), `features/capture/HistoryScreen.tsx`, `features/sync-history/SyncHistoryModal.tsx` |

### Known gaps

- **Older phones.** A phone still running the app from before Phase 19 sends captures as Active with no review status, as before, until the page is reloaded and the new version is loaded. The server accepts them (refusing would leave them stuck on the phone). Those records are treated as normal records.
- **Other screens.** Reports, the inventory and pickers outside the map still list a capture that awaits review; it shows status Planned there, never Active. A rejected capture is still in the equipment list with its reason; only the map, the "same one?" checks, the follow-up list and the tag lookup leave it out.
- **Proposed spans.** A "Next pole" proposed span that touches a rejected pole is not removed; confirm or remove it in **Spans to confirm**.
- **No self-approval rule.** Unlike change requests, an office person may accept a capture they made themselves.
- **The last moment before a crash.** IndexedDB writes finish a moment after each change (localStorage wrote at once). A browser killed in that moment can lose that last change on this device; the server copy is not affected.
- **Walkthrough.** The phone walkthrough at phone width was not run in this phase (no servers or browser were started); it is needed before the phase is marked done.
