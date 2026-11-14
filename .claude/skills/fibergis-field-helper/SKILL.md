---
name: fibergis-field-helper
description: Explains in very simple words how to do mapping work in the FiberGIS app as it exists today, step by step, for field staff, cable operators and owners who are not technical. Use whenever someone asks how to do something in the app, what a button or part does, why something is not working on the map, what a word like OLT, FAT, PON or splitter means, or says they do not understand, including how to place a pole, draw a cable, add a customer or connect OLT to customer. Use for explaining, not for changing code.
---

# FiberGIS field helper

Answer so that someone who left school early can follow it, or a supervisor can read it aloud.

## How to answer

- Short sentences and everyday words. One idea per line
- Numbered steps. One action per step
- Name buttons exactly as they appear on screen, in **bold**
- Say what they should see after each important step
- Say what is real work and what is optional
- Give the simple name first and the technical name in brackets: "the house wire (drop cable)"
- No code, file names, dB maths or formulas
- If they ask in Telugu, Kannada or Hindi, answer in that language, and say that a local speaker should check the words before printing them
- Only describe what the app really does. These steps were checked against the code, but screens change, so check the code if unsure. Never promise a button that does not exist
- If it is a known problem, say so first: "This is a problem in the app. It is not your mistake."
- **Say which device to use.** A computer is easiest. Since Phase 1 the map screen also works at phone size (360 px): the tools sit in a scrollable bar along the bottom, the menu is the button at the top left, and the right panel and windows open full screen with a large close button. The steps below were followed by a script in a real browser at 1500, 1024 and 360 px wide; nobody has yet tried them on a real phone in the street

- **For work in the street, send people to Field capture** (Phase 2): the green **Field capture** button at the bottom left of the phone map, or **Field capture** in the menu. It is a separate simple flow with big picture buttons, in English, Telugu or Kannada. The Telugu and Kannada words are drafts not yet checked by native speakers, so say so. It was tested only by a script in desktop Chrome at phone size with a fake camera and simulated GPS, never on a real phone or with workers

A printable version for workers: `docs/FIELD_WORKER_GUIDE.md`. Keep it in step with this file.

**Show me on the screen (Guide):** the blue **Guide** button on the map toolbar (also two buttons in Help) offers three guides with voice, no Next button:
- **Map the network step by step** (35 steps): the guide maps by itself on the real map while it explains each step aloud, with a hand moving to each button: OLT, FDT, feeder cable, FDT splitter, FAT, distribution cable, then the whole customer form. It does not tap Activate Subscriber (the app cannot delete a customer), and at the end it deletes the cables and boxes it made, named DEMO, so the map is as before. Closed early, it removes them then; after a reload, the next time the app opens. Taps are blocked while it runs; Pause, Back and Close work. Needs a freshly started `npm run dev`, or it may miss what it made.
- **Tour of every page** (18 steps): opens each menu page or window in turn, lights it up and explains it aloud, then goes on by itself when the voice ends. It changes nothing.
- **Try it yourself** (35 steps): the person really maps, on the real map, while the guide lights up the real button, says what to do and waits: Equipment, OLT, tap the map, OLT setup (Save Configuration); Equipment, FDT, tap the map; tap the OLT, Draw feeder cable, tap along the road and on the FDT, Finish; the Save Cable pages (Kind and Fibres, Ends with Yes, connect and the OLT PON port, Check with Save Cable); Select to stop drawing; the FDT's Connectivity tab, 1:8, Add splitter; Equipment, FAT, tap the map; the FDT's Details tab, Tools, Start cable here, draw to the FAT, the Save Cable pages, Select; Add customer: box, 1:8 and Add splitter if the box has none, a free output port and Fiber 1, Use my GPS or Pick on map, Activate Subscriber (and Save anyway if it asks about missing details); tap the customer and read Service Path. What is made is real work (Undo takes it back). It moves the map to the new item when needed.
- **Back** says the step again; **Pause** and **Repeat**; closing keeps the place, and **Guide** then offers **Continue where you stopped**, also after a reload.
- The customer it makes shows **Not linked** in Service Path until the office links the splitter input fibers; the guide does not teach that yet.
- Voice: the server speaks each step (English recorded 12 Nov 2026). Telugu and Kannada words and voice are unchecked drafts.

## Logging in (Phase 9)

Until the office creates the first administrator account, there is no login screen ("Login is off" banner). After that: 1. **Who are you?** Tap your name if it is shown, or **Someone else**, type **Your login name**, **Next**. 2. Type **Your password** (**Show** to see it), **Log in**. 3. First time: **Choose your own password**: the one the office gave, then a new one, **Save password**. Forgot it: the office sets a new one (Administration, **Users and roles**). Too many wrong tries: wait the minutes shown. Unsent work on the phone is kept and sent after login. A **viewer** can only look; a **technician** can do jobs and field capture but cannot delete network items (the screen says so in plain words). Nobody has tried this on a real phone yet.

## Field capture (phone, in the street)

**Before the first time:** the phone asks "Use your camera?" and "Know your location?". Tap **Allow** both times. Tapped **Block** by mistake? Tap the lock next to the web address, then **Permissions**, then **Allow**. On a phone the address must start with **https**; if the screen says "This address is not secure", tell the owner (`docs/DEPLOYMENT_GUIDE.md`).

**Add a pole:** 1. Tap **Add pole**. 2. Stand back, fit the whole pole in the frame, tap **Take photo**. 3. Wait for the green tick; never walk closer for it. 4. If it asks **Is it the same pole?**, tap the pole if it is, or **No, a new one**. 5. Point at the tag, or tap **No tag**. 6. Tap **Cable pole**, **Electric pole** or **Don't know**. 7. Tap **Cement**, **Iron**, **Wood** or **Don't know**. 8. Check the card, tap **Save**. Then **Next pole** goes straight to the camera. "Next pole" only remembers the order; it does not claim a cable. The office sees a dashed line between the two poles and confirms it or removes it.

**Add a box:** **Add box**, photo, tag or **No tag**, **Street box**, **Joint box** or **Don't know**, **Save**.

**Add a customer drop:** **Add customer drop**, photo of the wire at the house, tap the customer or **Not in the list**, **Save**.

**Record a light level:** **Record light level**, tap the customer, photo of the meter screen, then type only the digits shown: for -18.52 type 1 8 5 2 (no minus, no dot). Check the big number matches the meter, tap **Save**. It is saved as **Measured**, with the photo as proof.

**Report danger:** **Report danger**, take the photo from where you are, **Save**. Stay away and keep others away.

**No green tick:** go to open sky and wait. If it still does not come, tap **Save without place. Office will place it.** The office places it later from **Operations**, **Field captures**, using **Show on map** and then **Move this item**. Workers never fix it on the map.

**The box at the top right:** **Saved on phone 3** (kept on the phone, sent when there is signal), **Sending**, **Sent to office** (the office has the record and its photos), **Not saved on phone** in red (storage not working: stop and call the supervisor).

**Mistake:** right after saving, tap **Undo**; only that item is removed. **Call supervisor** shows on the first screen once the office has typed the number in Administration, **Field capture settings**.

**It works without signal:** captures save on the phone and send later. The map picture needs internet. The app itself opens offline only after one visit with signal, and only on an https address.

## My jobs (technician, phone)

Since Phase 8 a technician does an office job on the phone at **/jobs**: tap **My jobs** on the Field capture home. Checked only by a script at phone size with a fake camera, never by a technician or on a real phone.

1. With login on, the jobs are the logged-in technician's own. While login is off (setup mode), **Who are you?** asks you to tap your name (names come from the jobs the office made); not there, the office must put your name on the job.
2. Tap the job. **TEST job. Not real.** in purple means a practice job.
3. **Show the way** opens the bike map with real GPS. Do not touch the phone while riding.
4. **Start job**, then the camera: **Photo before**.
5. Tap each step when done. **Material used**: tap the picture, type how many, **Save**. **Add a note** if needed.
6. **Photo after**, then **Repair done**.
7. **Check the repair**: **Light level reading** (house, meter photo, digits only, **Save**; saved as measured in the field with the photo) or **Photo of the working device**.
8. It says **Check saved. The office will close the job.** The phone never closes the job or the fault.

Every save shows **Saved** and **Undo** (takes back only that one thing; the office still sees it was taken back). **Stop for now** pauses the job with a reason; **Start again** resumes. The top right box is the same **Saved on phone / Sending / Sent to office**.

**Someone else changed this:** shown when the phone was offline and the office changed the same job (or any record) meanwhile. Both versions are kept. **Keep theirs**, **Keep mine**, or **Office decides** (the office then picks in **Operations**, **Changed twice**, with **Use the phone version** or **Keep the office version**).

**Example.** "How do I add a pole?"

> 1. On the map, tap **Equipment**.
> 2. Find **Telecom Pole (T-Crossarm)** and tap it.
> 3. Tap the empty map where the pole stands.
> 4. If it asks **Is this the same one?**, a pole is already mapped there. Tap **Same one: show it** if it is that pole, or **No, add a new one** if it really is another pole.
>
> You will see the pole on the map, named with the next number. Keep tapping for each pole. Tap **Done** when finished.

## Simple names

| Say | Technical name | What it is |
|---|---|---|
| Main machine | OLT | The big machine in the office that sends internet |
| Shared line system | PON | One line from the main machine is shared by many houses, using dividers |
| Line number | PON port | One output on the main machine. The screen says **OLT PON port** |
| Office panel | ODF | Panel where office fibers join road cables |
| Main road line | Feeder cable | Big cable from the office |
| Street line | Distribution cable | Cable going along a street |
| House wire | Drop cable | Thin wire to one house |
| Street box | FAT or terminal box | Box on a pole that serves nearby houses |
| Divider | Splitter | Splits one signal into many |
| Joint box | Closure | Sealed box where cables are joined |
| Joining | Splicing | Melting two fibers together |
| House device | ONT or ONU | Small box inside the customer's home |
| Thread | Core | One glass fiber inside a cable |
| Light level | Rx power | How strong the signal is at the house |
| TV line | Coax | Cable TV copper cable |
| TV box on the road | Node, amplifier | Boosts and sends TV signal |

## Connect the main machine to a house

**Always do it in this order: machine, box, cable, then customer.** A customer added before the cable shows **Not linked**; after drawing the cable, open the customer and tap **Link to OLT**. Always draw from the machine side toward the house.

**1. Place the main machine**
1. Tap **Equipment**. Tap the OLT you want. Tap the map.
2. A setup window opens. Open **3. PON Ports** and choose the number of lines.
3. Tap **Save Configuration**.

**2. Place the street box**
Tap **Equipment**, then **FAT Terminal Box** or **Pole-Mounted Terminal Box**, then the map. Other kinds of box will not appear in the customer form.

**3. Draw the cable**
0. If the dark **Equipment Toolbox** panel on the left is in the way, tap its small arrow to close it.
1. Tap the main machine on the map.
2. In the small window, tap **Draw feeder cable**. The map may move, so find the box again.
3. Tap along the road, one point at each corner. Tapping a pole's pin puts the point exactly on that pole.
4. **Tap on the box pin itself.** This joins at any zoom. Tapping the empty map within 30 metres of it also joins.
5. Tap **Finish**. The **Save Cable** window opens.
6. The window says **Your line touches** and names what the line starts and ends on. Nothing is connected yet. If the names are right, tap **Yes, connect**. If not, tap **No, leave blank** and choose them in **Starts at** and **Ends at**.
7. Check **OLT PON port**. The app suggests the first free one. Choose the real one.
8. Tap **Save Cable**. **More details** is optional; maker, owner and installation start as "Not recorded".
9. If an end is still blank, the app asks first and says customers on it cannot be traced. Tap **Go back** to fix it, or **Save without connecting** if you really mean it (this is logged).

Starting from a box or another item: tap it, open **Tools** on the right, tap **Start cable here**. If going through more than one box, draw each piece from the machine side.

**4. Add the customer**
1. Tap **Add customer**.
2. Type **Subscriber Full Name** and **Mobile Contact Phone**. Only the name is forced, but please type both.
3. Look at **Access Terminal (FAT)**. The app chooses a box by itself, and it may be the wrong one. Choose yours.
4. If a yellow message says there is no splitter, choose the size of your real divider and tap **Add splitter**. If the box says no free port, the divider is full, so tell your supervisor.
5. Read **Upstream path**. It should show your machine. If it says **No OLT reachable**, stop. The cable did not join, so fix the cable first. If you activate anyway, the app asks first and saves the customer as not linked.
6. Stand at the house and tap **Use my GPS**, or tap **Pick on map** and tap the house. The position starts empty; nothing is filled in for you. If there is no position, the app asks first and the house wire has no length until one is recorded.
7. In **ONT Serial Number**, type the number on the device label. Leave it blank if you cannot read it; the app does not make one up.
8. Tap **Activate Subscriber**.

You will see the customer with a line to the box. That line is the house wire. The app draws it by itself as a straight line, so do not draw it again.

**5. Check it**
Tap the customer's pin. The box's pop-up card can hide it, so if you cannot find it, type the name in the search bar at the top and choose it. On the right, read **SERVICE PATH**. "Not linked" means that part is missing. This is the check to trust.

**Trace service path** shows more detail. It no longer guesses: any missing link is listed in red at the top and marked in the chain, and a path with a missing link shows no pass. Under **Fiber by fiber** it says **Every fiber recorded** when the office has recorded each fiber, splice and patch from the machine to the house; then it follows that exact fiber and gives the light budget both ways. If it says **Cables only**, it names the first fiber link nobody has recorded yet, and it cannot prove light reaches the house. Do not send a crew based on it alone.

**Tell them:** this only records the work on the map. **Activate Subscriber** does not turn on internet on the real machine. A light level always says where it came from: **Estimated**, **Measured**, **Sample data** or **Not recorded**. Only **Measured** is a real reading, and there is no live link to the machines.

## Other jobs

**Add any other item:** tap **Equipment**, tap the item, tap the map.

**Record fibers, splices and patches (office):** tap a cable, open **Fibers**, tap **Fiber layout and colours** and choose the colour order and fibers per tube from the drum sheet. Tap a fiber to reserve or release it. Tap a closure pin and **Set up closure**, then **Splices and trays**: choose the tray, the fiber coming from the machine side and the fiber going to customers; nothing is chosen for you. Tap an ODF and add its panel, then tap a port to record the feeder fiber behind it and the patch to the OLT port. Tap a box and **Add splitter**, choosing the fiber that feeds it. A fiber already used, or a second splice on one fiber, is refused and the message says why.

**Which poles carry a cable, which cables are on a pole (office):** tap the cable and read **Poles supporting this route**, or tap the pole and read **Cables on this pole**. "No cables are recorded" means nobody has recorded it yet; a cable drawn past a pole does not count. To record them, tap the cable, tap **Find poles near this line**, tick only the poles you know carry it, choose **Planned**, **Built** or **Verified on site**, and tap **Save**.

**Dashed line between two poles (office):** a worker captured them one after the other with **Next pole**. Tap the line, then **Yes, built**, **Yes, planned** or **Not a span**. The same list is in **Operations**, **Field captures**, under **Spans to confirm**.

**Bring in a Google Earth file (office):** open **Administration**, **Backup & KML**, tap **Import KML or KMZ (preview first)** and choose the file. For each group, say what it is, or **Do not import**, and whether it is **Already in the street** or **Only planned**. Read the list of what cannot be imported and why. Nothing is connected for you. **Undo** removes the whole import.

**Move a box or pole:** tap it, open **Tools**, tap **Move this item**, then drag the pin. Its cable ends move with it, as one step you can undo. Pins cannot be dragged otherwise.

**House in the wrong place, or no place:** open the customer. A yellow box says **House location not recorded**; tap **Use my GPS** or **Pick on map**.

**Report a problem (office):** tap the bell icon at the top, or the blue **Create** button in the menu and then **Report a fault**, or **Operations** then **Faults and alarms**. The window **Faults and field work** opens. It says **No live connection** while no machine sends data: then every alarm is typed by a person, comes from the field, or is a TEST. Alarms from a monitoring source say **Reported by a monitoring source**. Tap **Report Outage** (it covers damage too), choose what happened and what it is on, tap **Save the report**. On a phone the bell is hidden: open the menu first.

**Practice with a TEST event (office):** in the same window tap **Make a TEST event**, choose a splitter, tick the customers, tap **Make TEST event**. Everything it makes says **TEST · not real**, is not counted as an outage, and is left out of reports unless **Include TEST events** is ticked.

**Find the likely cause (office):** open **Suspected causes**. It says, for example, "5 of 6 customers recorded on splitter Splitter 2 are reported down (1 have no alarm)" with **low**, **medium** or **high** confidence. It is always a suspicion, never proof of a cut. A yellow box **Not recorded, so less sure** names missing links. Tap **Open a fault for this**. The fault lists the customers on recorded paths, and apart from them **May be affected, path not fully recorded**. **Who is affected?** answers the same for any cable, fiber, closure, splitter, PON port, pole or span.

**Work orders (office):** in the fault, tap **Make a work order**, type the technician's name and the steps, tap **Make the work order**. Or open **Operations**, tap **Create Work Order**. A fault or work order closes only with a check: a light reading measured in the field (from **My jobs**), a photo, or **Record office check**. Without one, **Close the fault** is refused with a plain message, and the server refuses it too. The fault shows the whole **Repair, check and resolution history**.

**Cable TV (office):** open **Cable TV** in the menu. Tabs: **RF tree** (the TV line from the headend to each set top box; pieces no headend reaches are listed with what is missing), **Items** (add a headend, node, amplifier, tap, set top box; say powered or passive, never guess), **Links** (which OUT port feeds which IN port; one tap port takes one house wire), **Levels** (tap **Record a level**, choose the **Unit on the meter**, fill **Level as read**, **Read by** and **Meter**), **TV customers** (tap **Add Cable TV customer** and choose a free tap port), **Checks** (what is wrong or missing). The limits are changed in **Administration**, **Cable TV settings**, by an engineer or the administrator. No PON splitter rule applies here.

**Is a customer online? (office):** open the customer and read **Live status**. It says **Online**, **Offline**, **LOS (no light)**, **Power lost (dying gasp)** or **Unknown**, with how long ago, and which source said it. **Live** means a real machine sent it a short time ago. **Stale** means the last news is old: the customer may have changed since. **No live connection** means nothing has come from a machine for this customer: we do not know. **TEST · not real** is practice only. Offline alone does not mean the cable is cut. All customers together: menu, **Live status**.

**Bring in readings from the OLT (administrator or engineer):** menu, **Live status**, **Import file**. Choose the source, choose the file the OLT or its software exported, say which column is which, say what each status word means, tap **Preview**, read **Not matched** and **Skipped**, then **Import**. A row is shown on a customer only when its ONU address or serial is exactly the one on their ONT record. Sources, push tokens and the **TEST simulator** are for the administrator only (**Sources**).

**Track a duty day:** open **Agent Tracking**. Type your name. Tap **Start Duty**. Allow location. Keep the page open. Tap **End Duty** when finished. Then tap **CSV** or **PDF** under **Daily report**.

**Navigate on a bike:** open **Field Work**, then **Open Biker Mode**, or tap **Navigate** on a job (or **Show the way** in **My jobs**). Do not touch the phone while riding. **Drop Pole Here** uses your real GPS position and says how accurate it was. With no GPS it saves nothing and says so.

**Fix a mistake:** tap the Undo arrow (curved arrow on the map toolbar) straight away. It does not work after you close or reload the page. While drawing, use **Undo point** for the last point.

## Common problems

| They say | Likely reason | Tell them |
|---|---|---|
| The line did not end on the box | The last tap missed the pin | Tap **Undo point**, then tap on the box pin itself |
| The ends are blank in Save Cable | **Yes, connect** was not tapped | Tap **Yes, connect**, or choose the ends in the lists |
| A message covers the screen | On a phone or tablet, messages show at the top and taps pass through them | Keep working; they close by themselves |
| Route line jumps onto a pole | The line joins anything within 30 metres | Tap **Undo point**, then tap further from that pole |
| Customer shows "Not linked" | Added before the cable, or the cable did not join | Draw the cable to the box, then open the customer and tap **Link to OLT** |
| Box is not in the customer form | Wrong kind of box | Use **FAT Terminal Box** or **Pole-Mounted Terminal Box** |
| Cable does not join, thinking of using **Connect what feeds this** (was Splice (Upstream)) | That button adds a second straight cable | Do not use it for this. Redraw the cable |
| Fibers show only numbers, with a dashed circle and "Blue may not be fiber 1" | Nobody has recorded the cable's colour order | Check the drum sheet. The office records it on the cable under **Fiber layout and colours**. Do not guess from the colour |
| No location or GPS | Permission off, or no secure link | Allow location, stand under open sky. Over a plain http address that is not this computer, phones block GPS. Ask the owner |
| Map is blank | No internet | The map pictures need internet |
| Red "One Item Was Not Sent" | The office refused one item; everything else was sent | The item is still on this phone. Tap the cloud icon at the top to see which one. Correct it, then tap **Retry now** |
| Top bar says "Not saved on phone" | Phone storage is full | Stay connected until your work reaches the office. Do not close the app. Tell the owner |
| Field capture says "Saved on phone" for a long time | No signal, or the office refused an item | Keep working; it sends when there is signal. A red line saying an item was not accepted means: call the supervisor |
| Camera shows a white screen with "Open camera" | The live camera is blocked or missing | Tap **Open camera** to use the phone's own camera app, or allow the camera (lock icon, **Permissions**) |
| No speaker button | No voice recordings exist yet | Normal for now. Read the words, or ask a buddy |
| Pin moved by mistake | It can only move after **Move this item** | Tap Undo straight away. The cable ends go back too |
| **My jobs** shows "No jobs for you now" | The office has not put your name on a job, or you tapped the wrong name | Tap your name at the top, then **Not me**, and choose again. Otherwise call the office |
| "Someone else changed this" | You worked offline and the office changed the same thing | Nothing is lost. Tap **Office decides** if unsure |
| **Live status** says **No live connection** | No machine has sent anything for this customer, or the customer has no ONT record | Normal until the owner connects the OLT. Make the ONT record with the serial and OLT address exactly as the OLT writes them |
| A reading is listed under **Not matched** | The address or serial in the file is not exactly the one on any ONT record, or is on two | Fix the ONT record; the next reading will match. Nothing was guessed |
| **Close the fault** says it cannot be closed yet | No check is recorded | The technician records a light reading or photo in **My jobs**, or the office types what it checked and taps **Record office check** |

## Honesty rules

- Light levels say where they came from. **Estimated**, **Sample data** and **Not recorded** are not readings; only **Measured** is. A level from a machine is **Measured** with its time and source; old ones say **stale**. With no machine data, screens say **No live connection**. No OLT is connected yet, only file imports, a push from the owner's own script, and TEST
- Alarms are typed by people, come from the field, come from a monitoring source (it is named), or are **TEST**. A customer with no alarm is not proven to be working. A suspected cause is a suspicion, never proof of a cut
- The **Cable TV** page shows only recorded items, links and levels. Its level limits are "Proposed: check with your operators": no operator has confirmed them. Levels it works out are estimates, not readings
- Names typed by staff are not verified, because there is no login

## Safety, always

If the question involves poles or wires, add: mapping never needs climbing or touching a pole. Treat every wire as live. Do not use the phone while riding.
