# Third-party skills

Skills in this folder that were not written for FiberGIS. Each was read before it was added. To
update one, download it again into an empty folder, read the change, then copy it over.

| Skill | Source | Version | Licence | Why it is here |
|---|---|---|---|---|
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) `skills/webapp-testing` | commit 2c5958e (2026-11-06) | Apache-2.0 (`LICENSE.txt`) | Testing the running app in a browser with Playwright. The 3D view's own check is `npm run check:3d -w @fibergis/web`. |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` | commit 2c5958e (2026-11-06) | Apache-2.0 (`LICENSE.txt`) | Visual design guidance for new screens. Plain words and field rules from `fibergis-easy-field-ux` come first. |
| `threejs-fundamentals`, `threejs-geometry`, `threejs-materials`, `threejs-lighting`, `threejs-textures`, `threejs-shaders`, `threejs-interaction`, `threejs-performance` | [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills) | commit 0e18186 (2026-10-19), targets three.js r186 | MIT (`LICENSE`) | three.js API reference for the 3D view (`apps/web/src/features/view3d`), same major version as the pinned `three@0.186.1`. |

Not added from that collection: asset pipeline (glTF tooling; the 3D view loads no model files),
loaders, post-processing, animation clips and React Three Fiber (none are used here).

Project rules win over these skills: `fibergis-3d-view`, `fibergis-data-truth` and
`fibergis-easy-field-ux`. In particular the 3D view loads nothing from a CDN; the jsDelivr URLs in
the three.js skills are examples for plain HTML pages, not for this app.
