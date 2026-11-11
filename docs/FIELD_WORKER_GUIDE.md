# How to map in FiberGIS

Read this aloud to new staff, or print it. A **computer** is easiest. A **phone** now works for the steps below: the tools sit in a bar along the bottom, and the menu is the button at the top left.

## On a phone in the street: Field capture

This is the easy way to add poles, boxes, house wires, light levels and danger. It works in English, Telugu or Kannada. **The Telugu and Kannada words are drafts** and still need checking by a native speaker and crews.

**Open it:** on the map, tap the green **Field capture** button at the bottom left. Or open the menu (top left) and tap **Field capture**. The first time, choose your language, look at the pictures, and tap **Start**.

**Log in** (once the office has turned login on; until then there is no login screen):
1. **Who are you?** Tap your name if it is there (names already used on this phone). Not there: tap **Someone else**, type **Your login name**, tap **Next**.
2. Type **Your password** (tap **Show** to see it), tap **Log in**.
3. The first time, the phone asks you to **Choose your own password**. Type the one the office gave you, then your new one, tap **Save password**.

Forgot the password? Ask the office for a new one. Too many wrong tries: wait the minutes shown. Work saved on the phone is never lost: the screen says how many are waiting, and they are sent after you log in. No internet: keep working; log in when the signal is back.

**The phone asks two questions the first time:** "Use your camera?" and "Know your location?". Tap **Allow** both times. If you tapped **Block** by mistake: tap the lock next to the web address, then **Permissions**, then **Allow**.

### Add a pole

1. Tap **Add pole**.
2. Stand back. Fit the whole pole in the frame. Tap **Take photo**.
3. Wait for the green tick. Do not walk closer to the pole for it.
4. If the app shows a pole and asks **Is it the same pole?**: tap it if it is, or tap **No, a new one**.
5. Point the camera at the pole's tag (a QR code or a barcode). No tag? Tap **No tag**.
6. Tap the picture: **Cable pole**, **Electric pole** or **Don't know**.
7. Tap the picture: **Cement**, **Iron**, **Wood** or **Don't know**.
8. Check the card. Tap **Save**.

You will see a big tick and **Saved on phone**, and **The office will check it, then it goes on the network map** (more in [FIELD_MAPPING_GUIDE.md](FIELD_MAPPING_GUIDE.md)). Tap **Next pole** to go straight to the camera for the next pole. The office then sees the two poles joined by a dashed line until someone checks it; it does not say a cable is there. Tap **Finished** when the street is done.

### Add a box

Tap **Add box**, take the photo, scan the tag or tap **No tag**, tap **Street box**, **Joint box** or **Don't know**, then **Save**.

### Add a customer drop

Tap **Add customer drop**, take a photo of the wire where it reaches the house, tap the customer (nearest first, or search by name), or **Not in the list**, then **Save**.

### Record a light level

1. Tap **Record light level**.
2. Tap the customer.
3. Take a photo of the meter screen. The numbers must be clear.
4. Type only the numbers you see. **Skip the minus and the dot.** For -18.52, type 1 8 5 2. The big number on screen must match the meter.
5. Tap **Save**.

### Report danger

Tap **Report danger**. Stay where you are. Take the photo. Tap **Save**. Stay away, and keep others away.

### My jobs (repair work from the office)

The office gives you a job. You do it on the phone, step by step. Open **Field capture** and tap **My jobs** (or open the address that ends in **/jobs**).

1. The first time it asks **Who are you?** Tap your name. Not there? Ask the office to put your name on your job.
2. Tap the job. A purple line **TEST job. Not real.** means it is practice: do it the same way, nobody is waiting.
3. **Go to:** says where. Tap **Show the way** for the bike map. It uses your real GPS. Do not touch the phone while riding.
4. At the place, tap **Start job**. The camera opens: take the **Photo before**, before you touch anything.
5. Tap each step on the list when it is done. It turns green.
6. Used something? Tap **Material used**, tap the picture (**House wire**, **Connector**, **Splice sleeve**, **Patch cord**, **Splitter**), type how many with the number buttons, tap **Save**.
7. Want to tell the office something? Tap **Add a note**, write it, tap **Save**. Writing is not needed for anything else.
8. When the repair is finished, tap **Photo after** and take the photo.
9. Tap **Repair done**.
10. **Check the repair:** tap **Light level reading** (or **Photo of the working device** if you have no meter). For a reading: tap the house where you checked, take the photo of the meter screen, type only the numbers (for -19.20 type 1 9 2 0), check the big number matches, tap **Save**.
11. You see **Check saved. The office will close the job.** That is all. The office closes the job and the fault.

After every save you see **Saved** with an **Undo** button. Tap **Undo** to take back only that last thing. Must stop and come back later? Tap **Stop for now**, say why if you can, and tap **Stop for now** again. Next time tap **Start again**.

The box at the top right works the same as in field capture: **Saved on phone**, **Sending**, **Sent to office**. With no signal, keep working: everything waits on the phone.

### "Someone else changed this"

If you worked without signal and the office changed the same job at the same time, the phone shows **Someone else changed this**, with **Theirs (office)** and **Mine (this phone)**. Nothing is lost: both are kept. Tap one:

- **Keep theirs**: use the office's version.
- **Keep mine**: send your version.
- **Office decides**: you are not sure. The office chooses later.

### No green tick?

Go to open sky and wait. If it still does not come, tap **Save without place. Office will place it.** The office puts it on the map later. You never need to fix it on the map yourself.

### The box at the top right

- **Saved on phone 3**: three items are kept on this phone and will be sent when there is signal. You can keep working.
- **Sending**: they are going to the office now.
- **Sent to office**: the office has everything, photos too.
- **Not saved on phone** (red): the phone's storage is not working. Stop and call your supervisor.

To see what the phone has sent and what the office said, tap **What was sent** on the first screen ([FIELD_MAPPING_GUIDE.md](FIELD_MAPPING_GUIDE.md)).

**Made a mistake?** Right after saving, tap **Undo**. That one item is removed. **Call supervisor** is on the first screen if the office has set the number.

## Words

| We say | The app says | What it is |
|---|---|---|
| Main machine | OLT | The big machine in the office that sends internet |
| Line number | PON port | One output on the main machine |
| Street box | FAT | Box on a pole that serves nearby houses |
| Divider | Splitter | Splits one signal into many |
| House wire | Drop | Thin wire to one house |
| House device | ONT | Small box in the customer's home |

## Always work in this order

**Machine → Box → Cable → Customer**

If you add the customer before the cable, the customer shows **Not linked**. Once the cable is drawn, open the customer and tap **Link to OLT**.

## 1. Put the main machine on the map

1. Tap **Equipment**.
2. Tap the OLT.
3. Tap the empty map.
4. A window opens. Tap **3. PON Ports**. Choose the number of lines.
5. Tap **Save Configuration**.

## 2. Put the street box on the map

1. Tap **Equipment**.
2. Tap **FAT Terminal Box**.
3. Tap the empty map.

**Poles:** tap **Equipment**, then the pole. Each tap on the map adds the next numbered pole (Pole-01, Pole-02 and so on). Tap **Done** when the street is finished.

## 3. Draw the cable

1. Tap the main machine.
2. In the small window, tap **Draw feeder cable**. The map may move.
3. Tap along the road, at each corner.
4. Tap **on the box pin itself**. This works at any zoom.
5. Tap **Finish**.
6. The window says **Your line touches** and names the machine and the box. If they are right, tap **Yes, connect**. If not, tap **No, leave blank** and choose them in **Starts at** and **Ends at**.
7. Choose the real **OLT PON port**.
8. Tap **Save Cable**.

If an end is still blank, the app asks before saving and explains that customers on the cable cannot be traced. Tap **Go back** and choose the end.

## 4. Add the customer

1. Tap **Add customer**.
2. Type the name and phone number.
3. Check **Access Terminal (FAT)** shows your box.
4. If there is no divider, choose its size. Tap **Add splitter**.
5. Read **Upstream path**. If it says **No OLT reachable**, stop. Fix the cable first.
6. Stand at the house and tap **Use my GPS**. Or tap **Pick on map** and tap the house. Nothing is filled in for you.
7. **ONT Serial Number:** type the number from the device label. If you cannot read it, leave it blank.
8. Tap **Activate Subscriber**.

The app draws the house wire by itself. Do not draw it again. It also marks the house wire's fiber as used. If the office has recorded the fibers back to the machine, the main and street fibers are marked too.

## 5. Check your work

1. Type the customer's name in the search bar at the top. Choose it.
2. Read **SERVICE PATH**.
3. Every line should be filled. "Not linked" means something is missing.
4. **Trace service path** names any missing link in red at the top. A path with a missing link never shows a pass. When the office has recorded every fiber, it says **Every fiber recorded** and follows the exact fiber from the machine to the house. Otherwise it says **Cables only** and names the first fiber that is not recorded. That is office work, not yours.

## Is the customer online?

Open the customer. Read **Live status**.

- **Online**, **Offline**, **LOS (no light)**, **Power lost**: what the machine at the office said, and how long ago.
- **Live**: the machine sent it a short time ago.
- **Stale**: the news is old. The customer may have changed since.
- **No live connection**: no news from the machine. We do not know. This is normal until the owner connects the machine.
- **TEST · not real**: practice only.

Offline does not always mean a cut cable. The house may have no power. Check before you climb or dig.

## Cable TV page

Open **Cable TV** in the menu. It shows only what people recorded. Nothing is filled in for you.

- **RF tree**: the TV line from the headend down to each set top box. Pieces no headend reaches are listed with what is missing.
- **Items**: headend, node, amplifier, tap, set top box and more. Say if a node is powered or passive. Do not guess.
- **Links**: which OUT port feeds which IN port. One tap port takes one house wire.
- **Levels**: tap **Record a level**. Choose the **Unit on the meter** (dBµV or dBmV), write the **Level as read**, and fill **Read by** and **Meter**.
- **TV customers**: tap **Add Cable TV customer** and choose a free tap port.
- **Checks**: what is wrong or missing.

Every level limit is a guess until your operator checks it. The office changes them in **Administration**, **Cable TV settings**.

## Move a box or pole

Pins stay put, so a slip of the finger cannot move them. To move one: tap it, open **Tools**, tap **Move this item**, then drag the pin. The cable ends move with it. Tap **Cancel move** to stop.

## Made a mistake?

Tap the **Undo** arrow straight away. It does not work after you close the page.

## Remember

- This only records your work on the map. It does not turn on the customer's internet.
- A light level says where it came from: **Estimated**, **Measured**, **Sample data** or **Not recorded**. Only **Measured** is a real meter or device reading. A machine reading shows its time and says **stale** when it is old. With no news from the machine, the app says **No live connection**.
- If the top bar says **Not saved on phone**, the phone is full. Stay connected until your work reaches the office.
- If you are stuck, call your supervisor. Do not guess.

## Stay safe

*Draft wording. A qualified safety person should check it before printing.*

- Mapping never needs climbing or touching a pole.
- Treat every wire as live.
- Do not use the phone while riding.
- Report a leaning or sparking pole to the electricity office.

---

*For supervisors: these steps were followed by a script in a real browser, at computer, tablet (1024 px) and phone (360 px) sizes, on a test copy. They have not been tried with field workers or on a real phone in the street. Please watch two or three workers use this guide, and tell us where they get stuck. A Telugu or Kannada version needs a native speaker. The **My jobs** steps were checked the same way in November 2026 (a TEST job with a fake camera); no technician has used them yet.*
