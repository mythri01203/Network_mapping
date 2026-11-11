---
name: fibergis-3d-view
description: How the FiberGIS 3D Network View is built and how to change it safely. Use whenever work touches the 3D view, three.js, WebGL, the "2D Map | 3D View" switch, 3D models of equipment (OLT, switch, rack, poles, closures, FAT, cabinets, houses), the toScene3D adapter, camera presets, cutaways, light pulses, house lookup, the demo network, or adding a new equipment type that must also appear in 3D, even if the request only says "make it look real" or "show it in 3D".
---

# FiberGIS 3D view

The 3D view draws the same records as the 2D map. It is a picture of what is on record, never a
second source of truth. Full reference: `docs/3D-VIEW.md`. Visual spec: `docs/reference/ftth-3d.html`.

## Where things are

`apps/web/src/features/view3d/`

- `scene/` is pure TypeScript with no three.js. `toScene3D(records, options)` turns records into a
  `Scene3D`. `cascade.ts` walks PON trees, `lossBudget.ts` does the maths, `models.ts` maps types
  to models, and `demoNetwork.ts` holds the demo network.
- `engine/` holds three.js. `world.ts` builds a `THREE.Group` from a `Scene3D` without a renderer.
  `Engine.ts` adds the renderer, camera, loop and picking. The builders live in `engine/builders/`.
- `View3DView.tsx` is the lazy route at `/3d`. The panels are in `ui/` and the words in `i18n.ts`.

## Rules

1. **Data truth first.** Follow `fibergis-data-truth`. Paths come from recorded links (the fibre
   walk, then the customer's written links) and never from distance. A missing link is named. A
   fibre colour comes only from the cable's scheme. The drop colour is the FAT port colour code and
   is labelled that way. Losses come from the optical settings. Live status comes only through
   `showStatus` / `showFreshness`, and TEST stays TEST. Anything drawn without a record (rack power
   shelf, default pole height, a straight drop with no drawn route) is labelled or listed in the
   scene notes.
2. **Keep `toScene3D` pure.** Same input, same output. It reads no store and no `Date.now()` unless
   given `now`. Put new derived data there and test it in `scene/toScene3D.test.ts`.
3. **Every toolbox type is drawn.** A new equipment type goes in `BOX_MODELS` or `RACK_TYPES`
   (`scene/models.ts`). An unknown type falls back to a labelled generic box. Never let a record
   disappear.
4. **Performance.** Use `Kit` (`kit.box`, `kit.cyl`, `kit.std`) so geometries and materials are
   cached and freed. Anything per customer must be instanced or merged (houses, tags, drops,
   pulses). Do not create a mesh per house. Free everything in `dispose()`.
5. **Bundle.** three.js is imported only under `features/view3d/`. The shell (`MapModeSwitch`,
   `views.ts`) must not import from it, so the 2D bundle stays the same. Pin exact versions.
6. **Words.** Every visible string goes in `i18n.ts` in all five languages (en, kn, hi, te, ta),
   with the same `{placeholders}`. Scene-generated text is a `SceneText` key, not an English
   sentence. Buttons show the plain name with the technical term in small grey text. Colours always
   come with their names. Touch targets are at least 44 px (see `fibergis-easy-field-ux`).
7. **Selection sync.** A pick in 3D calls `useUiStore.select()` (never for demo records). Going to
   2D uses `useShowOnMap`.

## Checking a change

1. `npx vitest run src/features/view3d` (in `apps/web`), then `npx tsc --noEmit` and
   `npx eslint apps/web/src/features/view3d`.
2. `npx vite build` and confirm that `WebGLRenderer` appears only in the `View3DView-*.js` chunk.
3. Look at it: start the dev server (`npm run dev:web`, or `npx vite --port 5179` in `apps/web`)
   and run `npm run check:3d -w @fibergis/web -- --url http://localhost:5179`. It drives the
   installed Chrome or Edge, visits every preset, checks house 37's path, saves screenshots
   (`view3d-check/`, git-ignored), measures fps for 100 and 1000 houses (`/3d?bench=10`) and phone
   emulation, and fails on any page or console error. Look at the screenshots. Use `--software` on
   a machine without a GPU. Targets: 60 fps desktop, 30 fps phone for 1000 houses.
4. Update the mapping table and the checklist in `docs/3D-VIEW.md` when a model or behaviour changes.
