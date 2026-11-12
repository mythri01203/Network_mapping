/* ---------- three.js scene ---------- */
var host = document.getElementById('view');
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = Number(THREE.REVISION) >= 155 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
if (!NEW_THREE) renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
host.insertBefore(renderer.domElement, host.firstChild);
var scene = new THREE.Scene();
var SKY = 0xc9dcec;
/* sky: deeper blue overhead, pale haze at the horizon */
(function sky() {
  var c = document.createElement('canvas'); c.width = 4; c.height = 256; var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#4f8fd0'); gr.addColorStop(0.5, '#9cc4e4'); gr.addColorStop(1, '#d9e6ef'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  scene.background = srgb(new THREE.CanvasTexture(c));
})();
scene.fog = new THREE.Fog(SKY, 2500, 16000);
var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40000);
var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.8; controls.maxDistance = 22000;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a6a55, 0.62 * LIGHT_K));
var sun = new THREE.DirectionalLight(0xfff0d0, 0.95 * LIGHT_K);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
var SH = 230; sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH; sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH; sun.shadow.camera.near = 10; sun.shadow.camera.far = 1400; sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);

var B = { x0: 1e9, x1: -1e9, n0: 1e9, n1: -1e9 };
function grow(x, n) { B.x0 = Math.min(B.x0, x); B.x1 = Math.max(B.x1, x); B.n0 = Math.min(B.n0, n); B.n1 = Math.max(B.n1, n); }
customers.forEach(function (c) { grow(c.x, c.n); }); D.nodes.forEach(function (n) { grow(n.x, n.n); });
var CX = (B.x0 + B.x1) / 2, CN = (B.n0 + B.n1) / 2, SPAN = Math.max(B.x1 - B.x0, B.n1 - B.n0);

var matCache = {};
function lam(color) { return matCache[color] || (matCache[color] = new THREE.MeshLambertMaterial({ color: color })); }
function std(color, metal, rough) { var k = 's' + color + '_' + metal + '_' + rough; return matCache[k] || (matCache[k] = new THREE.MeshStandardMaterial({ color: color, metalness: metal, roughness: rough })); }
function glow(color) { return new THREE.MeshBasicMaterial({ color: color }); }
function white() { return new THREE.MeshLambertMaterial({ color: 0xffffff }); }
function box(parent, w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; }
function cyl(parent, r1, r2, h, mat, x, y, z, seg) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 12), mat); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; }

/* surface textures drawn on a canvas: no image files */
function surface(kind) {
  var S = 256, c = document.createElement('canvas'); c.width = S; c.height = S; var g = c.getContext('2d'), r = rng(kind.length * 977), i;
  function speck(n, lo, hi, a, max) { for (i = 0; i < n; i++) { var v = Math.floor(lo + r() * (hi - lo)); g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')'; g.fillRect(r() * S, r() * S, 1 + r() * max, 1 + r() * max); } }
  if (kind === 'ground') { g.fillStyle = '#8a9a78'; g.fillRect(0, 0, S, S); for (i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(96,120,70,.35)' : 'rgba(150,140,110,.3)'; g.fillRect(r() * S, r() * S, 2 + r() * 5, 2 + r() * 5); } }
  else if (kind === 'asphalt') { g.fillStyle = '#4a4e53'; g.fillRect(0, 0, S, S); speck(5000, 40, 110, 0.5, 2); }
  else if (kind === 'plaster') { g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, S, S); speck(2400, 150, 235, 0.25, 3); for (i = 0; i < 18; i++) { g.fillStyle = 'rgba(90,85,70,.07)'; g.fillRect(r() * S, 0, 2 + r() * 4, 40 + r() * 120); } var gd = g.createLinearGradient(0, S * 0.75, 0, S); gd.addColorStop(0, 'rgba(80,75,60,0)'); gd.addColorStop(1, 'rgba(80,75,60,.3)'); g.fillStyle = gd; g.fillRect(0, S * 0.75, S, S * 0.25); }
  else if (kind === 'tiles') { g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, S, S); for (var y = 0; y < 16; y++) for (var x = 0; x < 9; x++) { var v2 = Math.floor(170 + r() * 70); g.fillStyle = 'rgb(' + v2 + ',' + v2 + ',' + v2 + ')'; g.fillRect(x * 32 + (y % 2) * 16 - 16, y * 16, 30, 14); } }
  var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; srgb(t); t.anisotropy = 4; return t;
}
var groundTex = surface('ground'); groundTex.repeat.set(4000, 4000);
var ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

/* ---------- roads along every cable route (illustrative) ---------- */
(function roads() {
  var pos = [], idx = [], uv = [];
  cables.forEach(function (c) {
    var pts = c.pts, w = c.kind === 'dist' ? 7 : 9, run = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dn = b[1] - a[1], L = Math.hypot(dx, dn) || 1, px = -dn / L * w / 2, pn = dx / L * w / 2, base = pos.length / 3;
      if (i) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      pos.push(pts[i][0] + px, 0.06, -(pts[i][1] + pn), pts[i][0] - px, 0.06, -(pts[i][1] - pn)); uv.push(0, run / 8, 1, run / 8);
      if (i) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
  });
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  var m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, map: surface('asphalt'), side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m);
  var dp = [];
  cables.forEach(function (c) {
    if (c.kind === 'dist') return;
    var flat = c.pts.map(function (p) { return P(p[0], p[1], 0.1); }), cum = cumulative(flat), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (var s = 2; s + 3 < cum[cum.length - 1]; s += 9) { pointAt(flat, cum, s, a); pointAt(flat, cum, s + 3, b); dp.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  });
  var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf2f2f2 })));
})();

/* ---------- instancing helpers ---------- */
var dummy = new THREE.Object3D(), tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpC = new THREE.Color();
function instanced(geo, mat, n, shadow) { var m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.castShadow = !!shadow; m.receiveShadow = !!shadow; scene.add(m); return m; }
function place(x, y, z, ry, sx, sy, sz) { dummy.position.set(x, y, z); dummy.rotation.set(0, ry || 0, 0); dummy.scale.set(sx || 1, sy || sx || 1, sz || sx || 1); dummy.updateMatrix(); return dummy.matrix; }

/* ---------- poles: wooden pole in a concrete base, crossarm, three insulators, a strand clamp ---------- */
(function poles() {
  var n = D.poles.length, wood = lam(0x6b4a2e);
  var shaft = instanced(new THREE.CylinderGeometry(0.15, 0.22, 10, 8), wood, n, true);
  var arm = instanced(new THREE.BoxGeometry(2.4, 0.14, 0.16), wood, n, true);
  var ins = instanced(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 8), lam(0x8a5a3c), n * 3);
  var clamp = instanced(new THREE.BoxGeometry(0.4, 0.2, 0.12), std(0x9aa3ab, 0.8, 0.4), n);
  var base = instanced(new THREE.CylinderGeometry(0.34, 0.4, 0.3, 10), lam(0x9a9890), n);
  D.poles.forEach(function (p, i) {
    shaft.setMatrixAt(i, place(p[0], 5, -p[1])); arm.setMatrixAt(i, place(p[0], 9.6, -p[1]));
    for (var k = 0; k < 3; k++) ins.setMatrixAt(i * 3 + k, place(p[0] + (k - 1) * 0.95, 9.85, -p[1]));
    clamp.setMatrixAt(i, place(p[0], 8.3, -p[1])); base.setMatrixAt(i, place(p[0], 0.15, -p[1]));
  });
})();

/* ---------- houses: one per mapped customer ---------- */
var WALLS = [0xe9dcc3, 0xf0e2a8, 0xe6c3b8, 0xcfe0c2], ROOF = { active: 0x2e9d4f, inactive: 0x8b929a, affected: 0xd43a2f };
var LEDC = { active: 0x2bff72, inactive: 0x1c1f22, affected: 0xff2a2a };
var N = customers.length;
var wallTex = surface('plaster'); wallTex.repeat.set(2, 1);
var hBody = instanced(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshLambertMaterial({ color: 0xffffff, map: wallTex }), N, true);
var roofGeo = new THREE.ConeGeometry(6.3, 3.2, 4); roofGeo.rotateY(Math.PI / 4);
var roofTex = surface('tiles'); roofTex.repeat.set(3, 2);
var hRoof = instanced(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, map: roofTex }), N, true);
var hPlinth = instanced(new THREE.BoxGeometry(8.4, 0.5, 8.4), lam(0x8f8a80), N);
var hDoor = instanced(new THREE.BoxGeometry(1.2, 2.2, 0.12), lam(0x5a3a22), N);
var hWin = instanced(new THREE.BoxGeometry(1.6, 1.2, 0.1), lam(0x9fd0ee), N);
var hFrame = instanced(new THREE.BoxGeometry(1.9, 1.5, 0.06), lam(0xf3efe6), N);
var hOnu = instanced(new THREE.BoxGeometry(0.42, 0.55, 0.16), lam(0xf4f4f4), N);
var hLed = instanced(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
customers.forEach(function (c, i) {
  var f = nodes[c.fat];
  c.yaw = f ? Math.atan2(f.x - c.x, -(f.n - c.n)) : 0;        // the front wall faces its box
  var base = place(c.x, 2.25, -c.n, c.yaw).clone();
  c.wall = WALLS[i % 4];
  hBody.setMatrixAt(i, base);
  hRoof.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(0, 3.6, 0)));
  hPlinth.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(0, -2.0, 0)));
  hDoor.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(-1.8, -0.9, 4.03)));
  hFrame.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(1.4, 0.2, 4.0)));
  hWin.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(1.4, 0.2, 4.03)));
  hOnu.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(3.2, 0.6, 4.08)));
  hLed.setMatrixAt(i, tmpM.copy(base).multiply(tmpM2.makeTranslation(3.2, 0.78, 4.18)));
  c.onuAt = new THREE.Vector3(3.2, 0.6, 4.1).applyMatrix4(base);
});

/* ---------- trees ---------- */
(function trees() {
  var r = rng(20260111), list = [];
  customers.forEach(function (c) { var k = 1 + (r() < 0.5 ? 1 : 0); for (var j = 0; j < k; j++) { var a = c.yaw + Math.PI + (r() - 0.5) * 1.6, d = 9 + r() * 7; list.push([c.x + Math.sin(a) * d, c.n - Math.cos(a) * d, 0.8 + r() * 0.7]); } });
  cables.forEach(function (c) { if (c.kind === 'dist') return; for (var i = 0; i < c.pts.length - 1; i += 2) { var a = c.pts[i], b = c.pts[i + 1], dx = b[0] - a[0], dn = b[1] - a[1], L = Math.hypot(dx, dn) || 1, side = r() < 0.5 ? 1 : -1; list.push([a[0] + dx * r() - dn / L * 11 * side, a[1] + dn * r() + dx / L * 11 * side, 0.8 + r() * 0.7]); } });
  var trunk = instanced(new THREE.CylinderGeometry(0.22, 0.3, 3, 6), lam(0x5b4026), list.length, true);
  var crown = instanced(new THREE.IcosahedronGeometry(2.3, 1), lam(0x3f7d3a), list.length, true);
  var crown2 = instanced(new THREE.IcosahedronGeometry(1.7, 1), lam(0x4c9145), list.length, true);
  list.forEach(function (t, i) {
    trunk.setMatrixAt(i, place(t[0], 1.5 * t[2], -t[1], 0, t[2]));
    crown.setMatrixAt(i, place(t[0], 4.3 * t[2], -t[1], i, t[2], t[2] * 1.15, t[2]));
    crown2.setMatrixAt(i, place(t[0] + 0.9 * t[2], 5.6 * t[2], -t[1] + 0.5 * t[2], i * 2, t[2]));
  });
})();

/* ---------- cables: a tube close up, plus a thin line that stays visible from far ---------- */
var TRUNK = 0xffc233, DARK = 0x33383e, OFF = 0xaab0b6;
var view = 'live';
function ageColor(year) { var a = YEAR_NOW - year; return a <= 3 ? 0x22c55e : a <= 8 ? 0xf59e0b : 0xf0552b; }
function liveColor(c) { return c.pons.length === 1 ? hexNum(ponCol(c.pons[0])[1]) : TRUNK; }
var pickables = [];
var cableGroup = new THREE.Group(); scene.add(cableGroup);
function tube(pts, r, seg) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), Math.max(4, seg), r, 6, false); }
function buildCable(c) {
  if (c.group) { cableGroup.remove(c.group); c.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); pickables = pickables.filter(function (p) { return p.userData.cable !== c; }); }
  c.group = new THREE.Group(); c.parts = [];
  function part(a, b, role) {
    if (b - a < 0.5) return;
    var pts = slicePath(c.path, c.cum, a, b), mat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.55, metalness: 0.1 });
    var m = new THREE.Mesh(tube(pts, RADIUS[c.kind], Math.min(260, pts.length * 2)), mat); c.group.add(m);
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: DARK })); c.group.add(line);
    c.parts.push({ mesh: m, line: line, role: role });
  }
  if (c.cut === null) part(0, c.len, 'before'); else { part(0, Math.max(0, c.cut - 0.8), 'before'); part(Math.min(c.len, c.cut + 0.8), c.len, 'after'); }
  var pick = new THREE.Mesh(tube(c.path, 2.6, Math.min(120, c.path.length)), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  pick.userData.cable = c; c.group.add(pick); pickables.push(pick);
  cableGroup.add(c.group); c.builtCut = c.cut;
}
function paintCable(c) {
  var up = c.parent ? cutBefore(c.parent) : null, on = showCableF(c);
  c.group.visible = F.kinds[c.kind];
  c.parts.forEach(function (p) {
    var lit = !up && p.role === 'before';
    var col = !on ? OFF : view === 'age' ? ageColor(c.year) : (lit ? liveColor(c) : DARK);
    p.mesh.material.color.setHex(col); p.line.material.color.setHex(col);
    p.mesh.material.emissive.setHex(on && (view === 'age' || lit) ? col : 0x000000); p.mesh.material.emissiveIntensity = !on ? 0 : view === 'age' ? 0.3 : (lit ? 0.5 : 0);
  });
}

/* ---------- terminal boxes (FAT): a box on its pole with one adapter per splitter output ---------- */
var fatBody = instanced(new THREE.BoxGeometry(1.5, 1.0, 0.42), white(), fats.length, true);
var fatLid = instanced(new THREE.BoxGeometry(1.56, 1.06, 0.14), lam(0xc9ced2), fats.length);
var fatLatch = instanced(new THREE.BoxGeometry(0.1, 0.22, 0.1), lam(0x3d4246), fats.length * 2);
var fatBand = instanced(new THREE.BoxGeometry(0.5, 0.07, 0.5), std(0x9aa3ab, 0.85, 0.35), fats.length * 2);
var fatPortN = 0; fats.forEach(function (n) { n.sp.forEach(function (s) { fatPortN += s.outs.length; }); });
var fatPort = instanced(new THREE.BoxGeometry(0.13, 0.16, 0.13), white(), fatPortN);
var fatPlug = instanced(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 8), white(), fatPortN);
var fatLed = instanced(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), fats.length);
var portAt = {};     // 'fatId#port' -> where the drop leaves
(function buildFats() {
  var pi = 0;
  fats.forEach(function (n, i) {
    n.idx = i;
    fatBody.setMatrixAt(i, place(n.x, FAT_Y, -n.n + 0.36)); fatLid.setMatrixAt(i, place(n.x, FAT_Y, -n.n + 0.6));
    fatLatch.setMatrixAt(i * 2, place(n.x + 0.8, FAT_Y + 0.25, -n.n + 0.6)); fatLatch.setMatrixAt(i * 2 + 1, place(n.x + 0.8, FAT_Y - 0.25, -n.n + 0.6));
    fatBand.setMatrixAt(i * 2, place(n.x, FAT_Y + 0.3, -n.n + 0.1)); fatBand.setMatrixAt(i * 2 + 1, place(n.x, FAT_Y - 0.3, -n.n + 0.1));
    fatLed.setMatrixAt(i, place(n.x - 0.6, FAT_Y + 0.38, -n.n + 0.69));
    var all = []; n.sp.forEach(function (s) { s.outs.forEach(function (o) { all.push(o); }); });
    n.portBase = pi;
    all.forEach(function (o, k) {
      var px = n.x + (k - (all.length - 1) / 2) * 0.17;
      fatPort.setMatrixAt(pi, place(px, FAT_Y - 0.56, -n.n + 0.4)); fatPlug.setMatrixAt(pi, place(px, FAT_Y - 0.72, -n.n + 0.4));
      portAt[n.id + '#' + o[0]] = new THREE.Vector3(px, FAT_Y - 0.84, -n.n + 0.4);
      pi++;
    });
  });
})();

/* ---------- drops: all merged into one mesh, coloured per customer ---------- */
var dropMesh, dropLines, dropRanges = [];
(function drops() {
  var pos = [], nor = [], col = [], idx = [], lp = [], lc = [];
  customers.forEach(function (c) {
    var f = nodes[c.fat]; if (!f) { dropRanges.push([0, 0]); lp.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); for (var z = 0; z < 12; z++) lc.push(1); return; }
    var a = (c.op !== null && portAt[c.fat + '#' + c.op]) ? portAt[c.fat + '#' + c.op].clone() : P(f.x, f.n, FAT_Y - 0.8);
    var b = c.onuAt.clone(), mid = a.clone().lerp(b, 0.5); mid.y -= Math.min(1.4, 0.3 + 0.012 * a.distanceTo(b));
    c.dropPath = [a, mid, b]; c.dropCum = cumulative(c.dropPath);
    var g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(c.dropPath), 8, RADIUS.drop, 4, false);
    var base = pos.length / 3, p = g.attributes.position.array, q = g.attributes.normal.array, ix = g.index.array;
    for (var i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(q[i]); col.push(1); }
    for (var j = 0; j < ix.length; j++) idx.push(ix[j] + base);
    dropRanges.push([base, p.length / 3]); g.dispose();
    lp.push(a.x, a.y, a.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, b.x, b.y, b.z); for (var k = 0; k < 12; k++) lc.push(1);
  });
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
  dropMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); scene.add(dropMesh);
  var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  dropLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })); scene.add(dropLines);
})();
