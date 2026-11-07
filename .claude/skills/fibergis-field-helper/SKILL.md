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

## Field capture (phone, in the street)

**Before the first time:** the phone asks "Use your camera?" and "Know your location?". Tap **Allow** both times. Tapped **Block** by mistake? Tap the lock next to the web address, then **Permissions**, then **Allow**. On a phone the address must start with **https**; if the screen says "This address is not secure", tell the owner (`docs/DEPLOYMENT_GUIDE.md`).

**Add a pole:** 1. Tap **Add pole**. 2. Stand back, fit the whole pole in the frame, tap **Take photo**. 3. Wait for the green tick; never walk closer for it. 4. If it asks **Is it the same pole?**, tap the pole if it is, or **No, a new one**. 5. Point at the tag, or tap **No tag**. 6. Tap **Cable pole**, **Electric pole** or **Don't know**. 7. Tap **Cement**, **Iron**, **Wood** or **Don't know**. 8. Check the card, tap **Save**. Then **Next pole** goes straight to the camera. "Next pole" only remembers the order; it does not draw or claim a cable.

**Add a box:** **Add box**, photo, tag or **No tag**, **Street box**, **Joint box** or **Don't know**, **Save**.

**Add a customer drop:** **Add customer drop**, photo of the wire at the house, tap the customer or **Not in the list**, **Save**.

**Record a light level:** **Record light level**, tap the customer, photo of the meter screen, then type only the digits shown: for -18.52 type 1 8 5 2 (no minus, no dot). Check the big number matches the meter, tap **Save**. It is saved as **Measured**, with the photo as proof.

**Report danger:** **Report danger**, take the photo from where you are, **Save**. Stay away and keep others away.

**No green tick:** go to open sky and wait. If it still does not come, tap **Save without place. Office will place it.** The office places it later from **Operations**, **Field captures**, using **Show on map** and then **Move this item**. Workers never fix it on the map.

**The box at the top right:** **Saved on phone 3** (kept on the phone, sent when there is signal), **Sending**, **Sent to office** (the office has the record and its photos), **Not saved on phone** in red (storage not working: stop and call the supervisor).

**Mistake:** right after saving, tap **Undo**; only that item is removed. **Call supervisor** shows on the first screen once the office has typed the number in Administration, **Field capture settings**.

**It works without signal:** captures save on the phone and send later. The map picture needs internet. The app itself opens offline only after one visit with signal, and only on an https address.

**Example.** "How do I add a pole?"

> 1. On the map, tap **Equipment**.
> 2. Find **Telecom Pole (T-Crossarm)** and tap it.
> 3. Tap the empty map where the pole stands.
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

**Trace service path** shows more detail. It no longer guesses: any missing link is listed in red at the top and marked in the chain, and a path with a missing link shows no pass. It checks cables, not single fibers, so it still cannot prove light reaches the house. Do not send a crew based on it alone.

**Tell them:** this only records the work on the map. **Activate Subscriber** does not turn on internet on the real machine. A light level always says where it came from: **Estimated**, **Measured**, **Sample data** or **Not recorded**. Only **Measured** is a real reading, and there is no live link to the machines.

## Other jobs

**Add any other item:** tap **Equipment**, tap the item, tap the map.

**Move a box or pole:** tap it, open **Tools**, tap **Move this item**, then drag the pin. Its cable ends move with it, as one step you can undo. Pins cannot be dragged otherwise.

**House in the wrong place, or no place:** open the customer. A yellow box says **House location not recorded**; tap **Use my GPS** or **Pick on map**.

**Report a problem:** tap the bell icon at the top, or the blue **Create** button in the menu and then **Report a fault**. Then tap **Report Outage**. On a phone the bell is hidden: open the menu first.

**Work orders:** open **Operations**, tap **Create Work Order**.

**Track a duty day:** open **Agent Tracking**. Type your name. Tap **Start Duty**. Allow location. Keep the page open. Tap **End Duty** when finished. Then tap **CSV** or **PDF** under **Daily report**.

**Navigate on a bike:** open **Field Work**, then **Open Biker Mode**, or tap **Navigate** on a job. Do not touch the phone while riding. **Drop Pole Here** uses your real GPS position and says how accurate it was. With no GPS it saves nothing and says so.

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
| Cable does not join, thinking of using **Splice (Upstream)** | That button adds a second straight cable | Do not use it for this. Redraw the cable |
| No location or GPS | Permission off, or no secure link | Allow location, stand under open sky. Over a plain http address that is not this computer, phones block GPS. Ask the owner |
| Map is blank | No internet | The map pictures need internet |
| Red "One Item Was Not Sent" | The office refused one item; everything else was sent | The item is still on this phone. Tap the cloud icon at the top to see which one. Correct it, then tap **Retry now** |
| Top bar says "Not saved on phone" | Phone storage is full | Stay connected until your work reaches the office. Do not close the app. Tell the owner |
| Field capture says "Saved on phone" for a long time | No signal, or the office refused an item | Keep working; it sends when there is signal. A red line saying an item was not accepted means: call the supervisor |
| Camera shows a white screen with "Open camera" | The live camera is blocked or missing | Tap **Open camera** to use the phone's own camera app, or allow the camera (lock icon, **Permissions**) |
| No speaker button | No voice recordings exist yet | Normal for now. Read the words, or ask a buddy |
| Pin moved by mistake | It can only move after **Move this item** | Tap Undo straight away. The cable ends go back too |

## Honesty rules

- Light levels say where they came from. **Estimated**, **Sample data** and **Not recorded** are not readings; only **Measured** is. There is no link to the real machines yet, and screens say **No live connection**
- The **Cable TV** page is labelled "Example values, not your network"; only its customer names are real records
- Names typed by staff are not verified, because there is no login

## Safety, always

If the question involves poles or wires, add: mapping never needs climbing or touching a pole. Treat every wire as live. Do not use the phone while riding.
