# 3D Network View

The 3D view (`/3d`, top bar **2D Map | 3D View**) draws every mapped item in 3D: the central-office
rack with its OLT and switch, poles with power lines and the messenger strand, splitter closures, FAT
boxes, cabinets, every other toolbox type, the houses of all customers, and every cable along its
drawn route. It reads the same records as the 2D map. Nothing is saved from it.

The visual and behavioural spec is the single-file prototype in
[`docs/reference/ftth-3d.html`](reference/ftth-3d.html). The checklist at the end compares the two.

## Architecture

```
apps/web/src/features/view3d/
├── View3DView.tsx          React route: panels, selection sync, demo toggle, tour (lazy chunk)
├── view3dStore.ts          Per-device preferences: labels, pulses, language, theme, origin, tour seen
├── i18n.ts                 All words in English, Kannada, Hindi, Telugu and Tamil
├── scene/                  Pure data layer, no three.js
│   ├── toScene3D.ts        Records → Scene3D (the adapter). Pure; unit-tested
│   ├── cascade.ts          Walks each PON tree fibre by fibre, then from customer links
│   ├── lossBudget.ts       Port counts and optical budget from the optical settings
│   ├── models.ts           Equipment type → 3D model; TIA-598 port colour code
│   ├── geoLocal.ts         lat/lng → local metres (x east, z south), deterministic seeds
│   ├── presets.ts          Camera presets and whether the data has something for each
│   ├── demoNetwork.ts      "Load demo network": prototype layout as ordinary records
│   └── types.ts            The Scene3D shape
├── engine/                 three.js
│   ├── Engine.ts           Renderer, ACES, PMREM, shadows, fog, loop, picking, dispose
│   ├── controls.ts         Orbit / pan / zoom / pinch / keys, time-based easing
│   ├── world.ts            Scene3D → THREE.Group (no renderer, so it is testable)
│   ├── kit.ts              Cached materials and geometries, LEDs, text textures, labels
│   ├── textures.ts         Canvas surface textures: wood, brushed metal, plastic, concrete, rails
│   ├── mapGround.ts        Street map / satellite tiles stitched under the scene
│   ├── fibers.ts           Cables as tubes, light pulses, merged drops
│   ├── houses.ts           Instanced houses, number-tag atlas, fault markers, beam
│   └── builders/           rack.ts (rack, OLT, switch, ODF, UPS), plant.ts (poles, boxes),
│                           cutaways.ts (splitter box interiors, inside a house)
└── ui/                     Panels.tsx, OnboardingTour.tsx (+ WebGL fallback), style.ts
```

Data flows one way: network store → `toScene3D()` → `buildWorld()` → `View3DEngine`. React keeps
only the panels; the engine owns the WebGL objects and frees them in `dispose()`.

**Stack.** React 18, zustand, Tailwind and lucide icons (the app's own), plus `three@0.186.1`
(exact pin; `@types/three@0.186.0`). No other library. Orbit controls are hand-written, as in the
prototype. The route is lazy-loaded (`App.tsx`), so three.js is only in the `View3DView-*.js`
chunk (≈720 kB, ≈194 kB gzip) and the 2D map bundle did not grow.

**Selection sync.** Picking a house or a piece of equipment in 3D calls `useUiStore.select()`, so
the 2D map shows it; **Show on 2D map** and the top-bar **2D Map** button centre the map on it
(`useShowOnMap`). Opening 3D with something selected on the map focuses it (a customer: fly to
the house and highlight its drop; equipment: fly to it). The demo network never touches the app
selection.

**Origin.** Local metres start at the first OLT by default (`Centre on`: first OLT, project start
point, middle of the network). The tangent-plane projection is accurate to well under 1% across a
few kilometres. 1 scene unit = 1 metre. The prototype's rack and box models are built in its own
units and scaled (`RACK_SCALE = 0.16`, `GALLERY_SCALE = 0.4`, `HOME_SCALE = 0.55`).

## Data truth

The view follows `.claude/skills/fibergis-data-truth`:

- **Paths.** Each PON tree is walked fibre by fibre from the PON port (ODF patch or feeder core,
  splices, splitter inputs, cascade links, splitter outputs, drop fibres). Customers that walk does
  not reach are placed from the links written on the customer (OLT, PON, splitter, output). The
  panel says which ("Traced fiber by fiber" or "From links written on the customer") and names each
  missing link. Nothing is connected by distance.
- **Colours.** Drops are drawn in the **port colour code** of their FAT port (TIA-598 order of port
  numbers). That is a display convention, so it is labelled as such. The **drop fibre colour** comes
  only from the drop cable's recorded colour scheme (`coreIdentity`). With no scheme it says "not
  known", never TIA-598 by default.
- **Loss.** Splitter, fibre, connector and splice losses come from the optical settings
  (Administration → Optical settings), not from code. Distance is the drawn length of the cables
  on the longest path, labelled "drawn". Connectors are estimated as OLT patch + ONT + in/out at
  each box. The spec's figures (1:4 7.3 dB, 1:8 10.5 dB, 0.5 dB connector) differ from the current
  defaults (7.1, 10.4, 0.3); set them there if those are your numbers.
- **Live status.** PON-port LEDs follow `deviceStatuses` and houses get a red cone from
  `onuStatuses` (LOS, offline, dying gasp), through `showFreshness` / `showStatus`. Stale rows do
  not change the picture, and TEST rows stay labelled TEST. With no source, the card says "No live
  connection".
- **Drawing defaults.** Pole height (8 m telecom, 9 m electric), switch ports (24) and ODF ports (24)
  are used only when the record does not say. The power shelf and blank panels are rack furniture,
  labelled "typical, not on record". A drop with no drawn line is a faint straight line between the
  recorded box and the house. Every default in use is listed under "Drawn from defaults or with gaps".
- **Ground.** Under the network lies the real street map: the same tiles as the 2D map
  (Google streets, Google satellite or OpenStreetMap, from the 2D map's tile choice), or the
  satellite picture, or plain grass (**Ground** in the options; remembered per device). The tiles
  are stitched into one texture (`engine/mapGround.ts`, at most 12×12 tiles, zoom 18 at most so
  printed street names stay in scale) and placed by the same projection as the records. It is a
  picture of the area, not network data. With no internet it says so and shows plain ground. In
  the demo it says the map is a real place and the demo houses are not. The tile attribution is
  shown bottom right.
- **Big networks.** The base map covers the whole network; a sharper patch (`MapGround.focus`,
  zoom 17 to 19 by camera distance) follows what the camera looks at. Satellite is the default
  ground and is the plain picture (no printed names). Cables are drawn at near-real thickness;
  when the camera is high, a "far" layer (thin lines for cables, fixed-size dots for houses,
  poles, boxes and offices; `world.far`) stands in for them. OLT, FDT and FAT names keep a
  minimum size on screen and the engine hides any that would cover a more important one. The
  overview of a network wider than 300 m looks steeply down, like a map.
- **Moving around.** Map-style (`engine/controls.ts`): drag moves over the ground, the wheel or a
  pinch zooms towards the point under the pointer, right-drag / Shift-drag / two-finger twist
  turns, double-click goes to that spot. On-screen buttons zoom, turn and return to the whole
  network. Tapping a name label, or from far away a dot, selects that record and flies to it
  (`Engine.pickOnScreen`). The panels start folded on screens under 1600 px; the fiber panel opens
  when something is picked. Shadows follow the camera (`followShadows`).
- **Numbers shown.** All counted from records in `View3DView.tsx`: customers active / not active
  (recorded status), PON ports, splitter outputs and FAT ports in use / free, cables by fiber
  count, each PON's customers / free ports; on a box or OLT the customers whose recorded path
  goes through it ("if this fails, N customers lose service"); on a customer the status, plan and
  recorded Rx with its source. Trunk and distribution cables carry a "48F · PON-01" label; house
  dots and number tags show not-active customers in red / amber.
- **On the objects.** House tags read "219 · 2F · ~-19.1 dBm" (number, drop size, recorded Rx;
  "~" = calculated, not measured). Box labels carry a second line: outputs used of total, "N FREE",
  customers served and the Rx range of those customers. Cable labels read "12F G.652D · 1/12 used
  · PON-05" and can be tapped to open the cable: every fiber with its recorded colour, in use or
  free, and what it carries. A box's card lists every splitter output the same way. "Where a new
  connection can go" lists the boxes with a free output, for the chosen PON or all.
- **Stray records.** An item more than 20 km from the middle of the network (`mainBounds` in
  `scene/toScene3D.ts`, only when such items are under 10% of all) is still drawn where it is but
  does not stretch the scene, and is named under "Drawn from defaults or with gaps".
- **Demo.** The demo network is built as ordinary records with `isSampleData`, drawn through the
  same adapter, shown under a "Demo network: not your data" banner, and never saved. One house has a
  TEST "no light" status so the fault marker can be seen.

## Data mapping (record → 3D object)

| Record | Field(s) used | 3D object |
|---|---|---|
| Equipment `OLT` | `ponPorts` (status, vendor address, feeder), `chassis` cards, `technology`, `status` | OLT chassis in a rack: line cards with SFP cages, SC/APC plugs on used ports, dust caps on free ones, per-port LEDs, 2 control cards, fan tray |
| Equipment `Core Switch`, `Router`, `MikroTik Router`, `Firewall` | `logicalPorts` (RJ45 vs SFP), `totalPorts`, `usedPorts`, link to an OLT | 1U switch: RJ45 jacks with gold contacts and LEDs, Cat6 patches, SFP+ cages, OM3 uplink to the OLT |
| Equipment `ODF`, `Fiber Patch Panel` | `odfPanels[].ports` (patch, feeder) | ODF panel with SC adapters, yellow patches on used ones |
| Equipment `Optical Transmitter`, `Headend Equipment`, `Cable TV Headend` | name | 2U unit in the rack |
| Rack grouping | `rackId`, else `site`, else within 40 m of an OLT | one rack (19-inch rails with cage-nut holes, vented blanking panels) per group, in a cutaway equipment room (plaster walls, tiled floor, steel door, ceiling light, overhead cable ladder, earth bar) at the OLT's position. The OLT's name tag stays readable from the overview |
| Equipment `Telecom Pole`, `Electric Pole` | position, `heightMeters`, name | tapered wood-grain pole in a concrete collar, cap, number plate, step bolts, suspension clamp with through-bolt; electric poles get a crossarm with braces and porcelain pin insulators. Name tag when there are 40 poles or fewer |
| Span | `fromStructureId`, `toStructureId`, `routePoints` | messenger strand with sag; 3 power conductors when an end is an electric pole |
| Equipment `FDT`, closures, splitters, couplers, connectors, attenuators, distribution points | position, splitters inside, aerial cable ends | dome closure on the strand (aerial) or on the ground |
| Equipment `FAT`, terminal boxes (pole, wall, underground) | splitter outputs (status, customer), `totalPorts`, `poleNumber` | grey ABS box with hinged cover, latches, cable glands and pole bands (post drawn when the pole is not on the map); one SC/APC adapter per output with a dust shutter in the port-state colour, and a plugged connector on used ports |
| Equipment `FDMS`, `Fiber Distribution Cabinet` | position, ports | ground cabinet (FDH) with doors and vents |
| Equipment `Manhole`, `Handhole`, `Underground Chamber` | position | cover and rim at ground level |
| Equipment `Fiber Slack Loop` | position | coil (on the strand when aerial) |
| Equipment `ONT`, `ONU`, Wi-Fi router, modem, terminal, set-top box, instrument | position, status | small white unit on a post with an LED |
| Equipment `CATV Optical Node`, `CATV RF Amplifier`, `CATV Tap-Off Box` | position | finned aluminium housing on the strand or pole |
| Equipment `Building Entry Point`, `Junction Point`, `Duct`, `Microduct`, `Cable Tray` | position | wall box, or ground marker post |
| Any other (custom catalogue) type | name, type | labelled generic box |
| Cable | `coordinates`, `installationType`, attachments, start/end equipment, role from the walk | tube along the route: aerial at strand height with sag, else at ground level; feeder from the PON port up the rack and out of the room |
| Splitter | `ratio`, `terminalBoxId`, cascade level from the walk | port counts, stage cutaways, filters |
| Customer | position, links, `ontId` | instanced house (several at one point make a block), number tag, drop, fiber path text |
| `deviceStatuses` (PON port) | state, freshness | port LED: blink (up), red (down), amber (degraded) |
| `onuStatuses` | LOS / offline / dying gasp, freshness | red cone over the house, live status on the card |
| Origin + extent (no record) | the 2D map's tile provider, the **Ground** choice | street map or satellite texture on the ground |

## Adding a new equipment model

1. Add the type to `BOX_MODELS` in `scene/models.ts` (or `RACK_TYPES` for central-office gear). A
   type not listed is already drawn as a labelled generic box.
2. For a new kind of model, add it to `BoxModel` in `scene/types.ts`, give it a mount in
   `mountFor()` (`scene/toScene3D.ts`), and draw it in `smallModel()` (or a new function) in
   `engine/builders/plant.ts`. Build it from `kit.box` / `kit.cyl` / `kit.std` so geometries and
   materials are cached and freed. Call `markPick()` on the group so a click selects the record.
3. If it has ports, read them in `boxPorts()` and draw them with `portRow()`; that records the
   anchors drops attach to.
4. Add a row to the mapping table above, and a case to `scene/toScene3D.test.ts`.

## Performance

- Static batching (`engine/batch.ts`): after the world is built, every static part that shares a
  material (rack metal, screws, poles, crossarms, wires, boxes, port numbers, LEDs) is merged into
  one mesh, and clicks go to invisible pick boxes. A 1000-house network goes from thousands of
  draw calls to about 800, shadows included.
- Shadows are drawn once when the scene changes (`shadowMap.autoUpdate = false`), not every frame.
- Floating labels smaller than 8 px on screen are hidden (each is a draw call); they come back as
  the camera gets closer.
- LEDs share one material per state and blink phase (4 phases), so they batch too.
- Houses: 6 instanced meshes (walls, roof, door, window, ONT, LED) plus one for fault markers,
  whatever the number of customers. The smoke test builds 1000 houses and checks this.
- House number tags: one canvas atlas (up to 2048 tags) drawn by one instanced billboard shader.
- Drops: merged into one mesh with per-vertex colour. Dimming and highlighting rewrite the colour
  buffer; no per-drop draw calls.
- Light pulses: two instanced meshes; each pulse is scaled to its own fibre.
- Geometries and materials are cached by size and colour in `Kit` and freed on unmount, along with
  textures, the PMREM environment and the WebGL context (`forceContextLoss`).
- The render loop stops while the tab is hidden. The device pixel ratio is capped at 2 and lowered
  in 0.5 steps (down to 1) after two seconds under 28 fps.
- Camera easing is time-based, so presets arrive in about a second at any frame rate.
  `prefers-reduced-motion` turns off easing, pulses and blinking.
- All fibres are two merged meshes (drops, and everything else) with per-vertex colour; dimming
  and highlighting rewrite the colour buffers, so filters add no draw calls.
- **Measured** with `npm run check:3d -- --uncapped` (no vsync, so it shows what the scene sustains
  rather than the screen's refresh; best of three 3 s samples; Chrome, Intel Iris Xe integrated
  graphics, 1440×900, laptop on battery saver; `/3d?bench=10` is 1000 houses on 10 OLTs):

  | Scene | Target | Sustained |
  |---|---|---|
  | Demo, 100 houses | 60 fps | 122 fps |
  | 1000 houses, overview | 60 fps | 85 fps (611 draw calls, 745k triangles) |
  | 1000 houses, houses view | 60 fps | 86 fps |
  | Phone emulation 390×844 @2×, CPU 4× slower, 100 houses | 30 fps | 101 fps |
  | Phone emulation, CPU 4× slower, 1000 houses | 30 fps | 41 fps |

  Without `--uncapped` the numbers stop at the screen's refresh (60, or 30 on a laptop on battery).
  The phone rows are an emulation (this computer's GPU with a slowed CPU), not a real phone.
  Run the check on your own machines: numbers drop when other work is running.

## Accessibility and words

Every button has a visible label: the plain name, with the technical term in small grey text
(**Main Office Box** / OLT, **Home Connection Box** / FAT & drops). Touch targets are at least 44 px.
Colours always appear as chips with their names. The canvas is focusable: arrow keys orbit,
Shift+arrows pan, +/- zoom. There is a five-step tour (skippable, shown once, **Show me how**
reopens it) and a "?" help bubble on each panel. All words are in `i18n.ts` in English, Kannada,
Hindi, Telugu and Tamil. Non-English text is a draft (see `docs/LANGUAGE_REVIEW.md`). Without WebGL
the view shows a plain message and a **Back to 2D map** button.

## Tests

`npm run check:3d -w @fibergis/web` (with the dev server running; `--url`, `--software`, `--out`,
`--chrome`) drives the real app in the Chrome or Edge already installed (`playwright-core`, pinned,
downloads no browser). It loads the demo, visits every preset, looks up house 37 and checks its
path, takes screenshots, measures frame rates (above), and fails on any page or console error.

- `scene/toScene3D.test.ts`: projection, loss-budget maths (and operator overrides), model table,
  the demo cascade (levels, 128 design / 100 used / 28 spare), fibre paths, roles, live status,
  purity, the bundled sample network (every equipment record drawn, gaps named), an empty network.
- `engine/world.test.ts`: smoke test that builds the world without WebGL. It checks object counts,
  presets, focus targets, 1000 instanced houses at a fixed draw-call count, drop highlighting and
  disposal.
- `i18n.test.ts`: every key in all five languages with the same placeholders.

## Checklist against the prototype (section 2 of the brief)

| # | Item | Result |
|---|---|---|
| 2.1 | ACES tone mapping, sRGB, PMREM environment, soft shadows, fog | Pass |
| 2.1 | Orbit / pan / zoom, right- or Shift-drag pan, wheel / pinch, touch, smooth camera tweening | Pass |
| 2.1 | Presets: Overview, OLT, Switch, Splitter boxes, Poles / feeder, FAT & drops, Houses, Inside house | Pass (a preset with nothing to show is disabled) |
| 2.1 | Labels and Light pulses toggles; floating sprite labels | Pass |
| 2.1 | Caption bar in plain language | Pass (hidden on phones, as in the prototype) |
| 2.1 | Desktop and phone, 44 px targets, light and dark | Pass |
| 2.2 | 19" rack: posts, plates, translucent sides, UPS/rectifier, blanks, cable manager | Pass (UPS and blanks labelled "typical, not on record") |
| 2.2 | OLT from the record's port count: SFP cages, dark openings, green SC/APC on used, blue caps on free, 2 control cards with SFP+ and mgmt RJ45, rotating fans, ears and screws, LEDs bound to port status | Pass (no separate ejector levers) |
| 2.2 | 24-port switch: RJ45 with gold contacts, link/activity LEDs, 4 SFP+, Cat6 into the cable manager | Pass |
| 2.2 | OM3 aqua LC-duplex uplink switch → OLT control card | Pass, when the link is recorded on a logical port |
| 2.2 | Equipment generated from records | Pass |
| 2.3 | Wooden poles, crossarms, insulators, power lines, messenger strand, aerial fibre with sag | Pass (power lines on spans with an electric pole) |
| 2.3 | Feeder PON port → pole line → first splitter closure | Pass |
| 2.3 | Dome closures on the strand, FAT boxes on poles with labeled ports | Pass (each port: adapter coloured by state with its number printed above) |
| 2.3 | Geometry from pole, span and cable records (lat/lng → metres) | Pass |
| 2.4 | N-level cascades; demo 1:4 → 1:4 → 1:8 = 128 ports, 100 used, 28 spare on one PON | Pass |
| 2.4 | Total, used, spare, loss budget with fibre, connector and splice loss; class warning and recommendation | Pass (losses from the optical settings, see Data truth) |
| 2.4 | Warn above 1:64 or 1:128 | Pass |
| 2.5 | Open-box stage models: input pigtail, splice tray with coil, PLC module, numbered SC/APC adapters, coloured drops | Pass |
| 2.5 | Models generated from the ratio; "Stage 1: 1:4", "Stage 2: 1:4", "Stage 3: 1:8 (FAT)" | Pass |
| 2.6 | TIA-598 colours; drops in the colour of their FAT port | Pass (port colour code; the fibre's own colour shown separately from its scheme) |
| 2.6 | Filters All, Feeder, L1 outputs, L2 outputs, drops; others dim | Pass (one filter per level, any depth) |
| 2.6 | Light pulses: cyan 1490 nm down, amber 1310 nm up | Pass |
| 2.6 | Legend: OS2 yellow, OM3 aqua, Cat6 blue, TIA-598 drop colours | Pass |
| 2.6b | Up to ~1000 customers with InstancedMesh (walls, tile roof, door, window, ONT, blinking LED); deterministic colours | Pass |
| 2.6b | Number tags; click/tap or type a number, id or name → fly, beam, drop highlighted, others fade | Pass |
| 2.6b | Fibre path in plain words | Pass, e.g. `PON 1/1/1 → FDT-1 out 2 → FDT-2.2 out 1 → FAT-5 port 5 (Slate port code, Blue drop fiber)` |
| 2.6b | Aerial drop: FAT port → eave clamp → down the wall → wall box → ONT | Pass |
| 2.7 | Cutaway room: drop → eave clamp → ATB with SC/APC → yellow patch → ONT (PON, 4 LAN, LEDs) → LAN → Wi-Fi router → TV, labelled, in the selected customer's colour and port | Pass |
| 3 | 2D Map / 3D View switch with selection sync both ways | Pass |
| 3 | `toScene3D` pure, unit-tested; origin picker; 1 unit = 1 m | Pass |
| 3 | Live port and ONU status | Pass |
| 3 | 60 fps desktop / 30 fps phone for 1000 houses; dispose, pause when hidden, reuse, DPR ≤ 2 | Pass: 85 fps sustained on Iris Xe; 41 fps in phone emulation (CPU 4× slower). Not yet on a real phone |
| 3 | WebGL fallback | Pass |
| 3 | No external requests; pinned versions | Pass |
| 4 | Plain labels with grey technical term, 5-step tour, "?" bubbles, named colour chips, 5 languages | Pass (translations are drafts) |
