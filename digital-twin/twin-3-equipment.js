/* ---------- OLT room with a rack, FDT cabinets, splice closures ---------- */
var leds = [];        // { mesh, kind: 'rack'|'pon'|'box', node, pi, phase }
var fdtPorts = {};
function led(parent, x, y, z, r, color) { var m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), glow(color || 0x2bff72)); m.position.set(x, y, z); parent.add(m); return m; }
function plate(parent, text, w, h, x, y, z, fg) {
  var c = document.createElement('canvas'); c.width = 512; c.height = Math.max(32, Math.round(512 * h / w)); var g = c.getContext('2d');
  var px = Math.round(c.height * 0.62); g.font = '700 ' + px + 'px system-ui, sans-serif';
  while (px > 10 && g.measureText(text).width > 500) { px -= 2; g.font = '700 ' + px + 'px system-ui, sans-serif'; }
  g.fillStyle = fg || '#e6edf3'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, c.height / 2 + 2);
  var t = srgb(new THREE.CanvasTexture(c)); t.minFilter = THREE.LinearFilter;
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true })); m.position.set(x, y, z); parent.add(m); return m;
}
var rackAt = new THREE.Vector3();
(function oltRoom() {
  var n = oltNode, g = new THREE.Group(); g.position.copy(P(n.x, n.n, 0)); scene.add(g);
  var wall = lam(0xd9d4cb), metal = std(0xa4adb7, 0.9, 0.3), dark = std(0x1b2127, 0.6, 0.45), chassis = std(0x2c343c, 0.75, 0.4), face = std(0x46515c, 0.75, 0.33), frame = std(0x14181c, 0.8, 0.4);
  /* the room: slab, three walls, roof, open front */
  box(g, 7, 0.3, 6, lam(0x9a9890), 0, 0.15, 0).receiveShadow = true;
  box(g, 7, 3.4, 0.2, wall, 0, 2.0, -2.9).castShadow = true; box(g, 0.2, 3.4, 6, wall, -3.4, 2.0, 0).castShadow = true; box(g, 0.2, 3.4, 6, wall, 3.4, 2.0, 0).castShadow = true;
  box(g, 7.4, 0.25, 6.4, lam(0x8c8a84), 0, 3.85, 0).castShadow = true;
  box(g, 1.6, 0.06, 0.2, glow(0xfff6e0), 0, 3.68, 0.6);
  var bulb = new THREE.PointLight(0xfff2dd, NEW_THREE ? 14 : 0.9, 9); bulb.position.set(0, 3.2, 0.2); g.add(bulb);
  /* overhead cable ladder */
  box(g, 6.4, 0.06, 0.04, metal, 0, 3.1, -1.6); box(g, 6.4, 0.06, 0.04, metal, 0, 3.1, -1.2); for (var k = -10; k <= 10; k++) box(g, 0.04, 0.03, 0.4, metal, k * 0.3, 3.08, -1.4);
  /* 19-inch rack */
  var R = new THREE.Group(); R.position.set(0, 0.3, -1.6); g.add(R);
  [[-0.33, -0.4], [0.33, -0.4], [-0.33, 0.4], [0.33, 0.4]].forEach(function (p) { box(R, 0.05, 2.1, 0.05, frame, p[0], 1.05, p[1]); });
  box(R, 0.72, 0.05, 0.86, frame, 0, 2.12, 0); box(R, 0.72, 0.05, 0.86, frame, 0, 0.03, 0);
  [-0.3, 0.3].forEach(function (x) { box(R, 0.04, 2.0, 0.02, metal, x, 1.05, 0.41); });
  /* OLT chassis: one SFP cage, plug and light per PON port */
  var Z = 0.42, oy = 1.78;
  box(R, 0.6, 0.36, 0.7, chassis, 0, oy, 0.05); box(R, 0.66, 0.36, 0.02, face, 0, oy, Z);
  plate(R, D.olt.make + '  ·  GPON OLT', 0.34, 0.04, -0.1, oy + 0.145, Z + 0.012);
  var ports = D.olt.ports, step = 0.4 / Math.max(1, ports.length - 1);
  ports.forEach(function (p, i) {
    var x = -0.27 + i * step, col = ponCol(p.pi);
    box(R, 0.036, 0.03, 0.05, metal, x, oy + 0.03, Z + 0.01); box(R, 0.028, 0.02, 0.006, dark, x, oy + 0.03, Z + 0.037);
    if (p.pi >= 0) { box(R, 0.024, 0.02, 0.07, lam(hexNum(col[1])), x, oy + 0.03, Z + 0.06); cyl(R, 0.006, 0.006, 0.06, lam(0x1b1b1b), x, oy + 0.03, Z + 0.12, 6).rotation.x = Math.PI / 2; }
    else box(R, 0.026, 0.02, 0.012, lam(0x2a5fd0), x, oy + 0.03, Z + 0.04);
    leds.push({ mesh: led(R, x, oy + 0.062, Z + 0.016, 0.006), kind: 'pon', pi: p.pi, phase: i * 1.3 });
    plate(R, String(p.num), 0.03, 0.022, x, oy - 0.002, Z + 0.012);
  });
  plate(R, 'PON', 0.05, 0.022, -0.31, oy - 0.002, Z + 0.012, '#9fd4ff');
  /* control card: uplink cages and status lights; fan tray */
  [0.2, 0.26].forEach(function (x, i) { box(R, 0.036, 0.03, 0.05, metal, x, oy + 0.03, Z + 0.01); if (!i) box(R, 0.026, 0.02, 0.07, lam(0x10b5c4), x, oy + 0.03, Z + 0.06); });
  plate(R, 'UPLINK', 0.09, 0.022, 0.23, oy - 0.002, Z + 0.012, '#9fd4ff');
  for (var f = 0; f < 3; f++) { var fan = cyl(R, 0.05, 0.05, 0.01, dark, -0.2 + f * 0.13, oy - 0.1, Z + 0.012, 18); fan.rotation.x = Math.PI / 2; var ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.005, 6, 20), metal); ring.position.set(-0.2 + f * 0.13, oy - 0.1, Z + 0.016); R.add(ring); }
  for (var l = 0; l < 4; l++) leds.push({ mesh: led(R, 0.16 + l * 0.035, oy - 0.1, Z + 0.016, 0.007), kind: 'rack', phase: l * 2.1 });
  /* ODF: one panel per feeder, one adapter per fiber. A fiber in use keeps its recorded colour. */
  var feeders = cables.filter(function (c) { return c.kind === 'feeder'; }), odfN = 0; feeders.forEach(function (c) { odfN += c.cr.length; });
  var adapters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.019, 0.024, 0.03), white(), Math.max(1, odfN)), ai = 0; R.add(adapters);
  feeders.forEach(function (c, fi) {
    var y = 1.42 - fi * 0.2; box(R, 0.6, 0.17, 0.5, std(0x3a434c, 0.6, 0.45), 0, y, 0.1); box(R, 0.66, 0.17, 0.02, face, 0, y, Z);
    plate(R, 'ODF · ' + c.name, 0.4, 0.03, -0.05, y + 0.066, Z + 0.012);
    c.cr.forEach(function (k, j) {
      var perRow = Math.ceil(c.cr.length / 2), row = j < perRow ? 0 : 1, cx = -0.29 + (j % perRow) * (0.58 / Math.max(1, perRow - 1));
      dummy.position.set(cx, y + (row ? -0.045 : 0.012), Z + 0.02); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); adapters.setMatrixAt(ai, dummy.matrix);
      adapters.setColorAt(ai, tmpC.set(k[3] ? (k[2] || '#22a84a') : '#3b4652')); ai++;
    });
  });
  /* patch cords from each PON port down to the ODF, in the PON's colour */
  ports.forEach(function (p, i) {
    if (p.pi < 0) return;
    var x = -0.27 + i * step, tx = -0.29 + i * 0.05;
    var pts = [new THREE.Vector3(x, oy + 0.03, Z + 0.15), new THREE.Vector3(x, oy - 0.1, Z + 0.2), new THREE.Vector3(tx, 1.52, Z + 0.17), new THREE.Vector3(tx, 1.435, Z + 0.04)];
    R.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.004, 5, false), lam(hexNum(ponCol(p.pi)[1]))));
  });
  /* switch, power shelf, batteries */
  box(R, 0.6, 0.05, 0.4, chassis, 0, 0.98, 0.1); box(R, 0.66, 0.05, 0.02, face, 0, 0.98, Z);
  for (var s = 0; s < 24; s++) { box(R, 0.017, 0.015, 0.012, metal, -0.29 + s * 0.02, 0.98, Z + 0.012); if (s < 6) leds.push({ mesh: led(R, -0.29 + s * 0.02, 0.997, Z + 0.016, 0.003), kind: 'rack', phase: s }); }
  plate(R, 'SWITCH', 0.1, 0.022, 0.25, 0.98, Z + 0.012, '#9fd4ff');
  box(R, 0.6, 0.26, 0.6, std(0x23292f, 0.6, 0.5), 0, 0.62, 0.05); box(R, 0.66, 0.26, 0.02, std(0x2b333b, 0.7, 0.4), 0, 0.62, Z);
  plate(R, 'RECTIFIER 48 V', 0.3, 0.04, -0.12, 0.7, Z + 0.012); box(R, 0.16, 0.06, 0.006, glow(0x1fbf7a), 0.2, 0.62, Z + 0.012);
  box(R, 0.6, 0.34, 0.6, std(0x30363c, 0.4, 0.6), 0, 0.26, 0.05); box(R, 0.66, 0.34, 0.02, std(0x2b333b, 0.7, 0.4), 0, 0.26, Z); plate(R, 'BATTERY', 0.2, 0.04, 0, 0.3, Z + 0.012);
  plate(R, 'Switch, power shelf and batteries: typical, not on record', 0.64, 0.028, 0, 0.14, Z + 0.012, '#ffd27a');
  rackAt.set(n.x, 0.3 + oy - 0.2, -n.n - 1.6 + Z);
  /* riser pole outside the room: the feeders leave along the ladder and climb it to the pole line */
  cyl(g, 0.16, 0.22, 10, lam(0x6b4a2e), -3.85, 5, -1.62, 8).castShadow = true;
  box(g, 0.7, 0.12, 0.5, metal, -3.5, 3.08, -1.4);
  var pipe = cyl(g, 0.07, 0.07, 5.6, lam(0x2b2f33), -3.85, 6.0, -1.4, 8);
  pipe.castShadow = true;
  /* the room answers a click for the OLT */
  var hit = new THREE.Mesh(new THREE.BoxGeometry(7, 3.6, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.copy(P(n.x, n.n, 2)); hit.userData.node = n; scene.add(hit); pickables.push(hit);
})();
(function fdtAndClosures() {
  var steel = std(0x9aa3ab, 0.85, 0.35);
  D.nodes.forEach(function (n) {
    if (n.type === 'closure') {
      /* dome closure on its pole, with the base clamp and cable ports */
      var g = new THREE.Group(); g.position.copy(P(n.x, n.n, 0)); scene.add(g);
      cyl(g, 0.16, 0.22, 10, lam(0x6b4a2e), 0, 5, 0, 8).castShadow = true;
      var body = cyl(g, 0.34, 0.34, 1.2, lam(0x23282e), 0.7, 7.4, 0, 16); body.castShadow = true;
      var dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x23282e)); dome.position.set(0.7, 8.0, 0); g.add(dome);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 6, 20), steel); ring.rotation.x = Math.PI / 2; ring.position.set(0.7, 7.0, 0); g.add(ring);
      [[0, 0, 0.07], [0.16, 0.08, 0.045], [-0.16, 0.08, 0.045], [0.08, -0.17, 0.04], [-0.08, -0.17, 0.04]].forEach(function (p) { cyl(g, p[2], p[2], 0.25, lam(0x111315), 0.7 + p[0], 6.7, p[1], 8); });
      box(g, 0.75, 0.08, 0.1, steel, 0.35, 8.25, 0);
      body.userData.node = n; pickables.push(body);
    } else if (n.type === 'FDT') {
      /* street cabinet on a plinth, door open, the splitter module and its outputs inside */
      var c = new THREE.Group(); c.position.copy(P(n.x, n.n, 0)); scene.add(c);
      box(c, 2.0, 0.3, 1.1, lam(0x9a9890), 0, 0.15, 0);
      var shell = box(c, 1.7, 2.2, 0.8, std(0x6f8a74, 0.35, 0.55), 0, 1.4, 0); shell.castShadow = true;
      box(c, 1.9, 0.14, 1.0, lam(0x5b6f5f), 0, 2.57, 0);
      box(c, 1.5, 1.9, 0.04, lam(0x1c2126), 0, 1.4, 0.4);
      var door = box(c, 0.8, 2.0, 0.05, std(0x7f9a84, 0.35, 0.5), -1.03, 1.4, 0.756); door.rotation.y = 1.1 + Math.PI;   // open, hinged on the left edge
      box(c, 0.2, 0.2, 0.006, lam(0xf2c200), 0.6, 2.2, 0.425);
      /* the pole behind the cabinet and the riser pipe the cables climb */
      cyl(c, 0.16, 0.22, 10, lam(0x6b4a2e), 0.45, 5, -0.85, 8).castShadow = true;
      cyl(c, 0.09, 0.09, 4.2, lam(0x2b2f33), 0.45, 5.2, -0.62, 8);
      var y = 1.9; fdtPorts[n.id] = [];
      n.sp.forEach(function (s) {
        box(c, 1.3, 0.34, 0.12, std(0xa4adb7, 0.9, 0.3), 0, y, 0.47);
        plate(c, 'SPLITTER ' + s.ratio + (s.stage ? '  S' + s.stage : '') + '  ·  IN, then OUT 1 to ' + s.outs.length, 1.2, 0.08, 0, y + 0.115, 0.535, '#10161c');
        box(c, 0.1, 0.12, 0.1, lam(0x2b2f33), -0.55, y - 0.06, 0.56); box(c, 0.07, 0.07, 0.16, lam(0x22a84a), -0.55, y - 0.06, 0.64);
        s.outs.forEach(function (o, k) {
          var px = -0.36 + k * (0.92 / Math.max(1, s.outs.length - 1));
          box(c, 0.085, 0.11, 0.1, lam(0x2b2f33), px, y - 0.06, 0.56);
          fdtPorts[n.id].push({ plug: box(c, 0.06, 0.07, 0.16, new THREE.MeshLambertMaterial({ color: 0xffffff }), px, y - 0.06, 0.64), out: o });
        });
        y -= 0.5;
      });
      plate(c, n.name, 1.5, 0.16, 0, 2.3, 0.425);
      leds.push({ mesh: led(c, 0.72, 2.3, 0.44, 0.06), kind: 'box', node: n });
      shell.userData.node = n; pickables.push(shell);
    }
  });
})();
pickables.push(hBody, hRoof, fatBody, fatLid);

/* ---------- labels ---------- */
var labels = [];
function sprite(canvas, x, n, h, size) {
  var t = srgb(new THREE.CanvasTexture(canvas)); t.minFilter = THREE.LinearFilter;
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.position.copy(P(x, n, h)); s.center.set(0.5, 0); s.renderOrder = 10; s.userData = { aspect: canvas.width / canvas.height, size: size || 1 };
  labels.push(s); scene.add(s); return s;
}
function label(text, x, n, h, size, bg, fg) {
  var c = document.createElement('canvas'), g = c.getContext('2d'); g.font = '600 44px system-ui, sans-serif';
  var w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = 68;
  g = c.getContext('2d'); g.font = '600 44px system-ui, sans-serif'; g.fillStyle = bg || 'rgba(12,18,26,.85)';
  g.beginPath(); if (g.roundRect) g.roundRect(0, 0, w, 68, 14); else g.rect(0, 0, w, 68); g.fill();
  g.fillStyle = fg || '#fff'; g.textBaseline = 'middle'; g.fillText(text, 18, 36);
  return sprite(c, x, n, h, size);
}
/* the badge over a box: name, then per splitter the PON chip, ratio and stage, free outputs,
   calculated level in → out, and one square per output (PON colour = used, pale = free) */
function badge(n) {
  var w = 640, rowH = 112, h = 76 + n.sp.length * rowH + 8, c = document.createElement('canvas'); c.width = w; c.height = h;
  var g = c.getContext('2d'), font = function (px, wt) { return (wt || 600) + ' ' + px + 'px system-ui, sans-serif'; };
  g.fillStyle = 'rgba(13,20,30,.93)'; g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, h - 4, 20); else g.rect(2, 2, w - 4, h - 4); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 3; g.stroke();
  g.textBaseline = 'middle'; g.textAlign = 'center'; var size = 38; g.font = font(size); while (size > 16 && g.measureText(n.name).width > w - 28) { size -= 2; g.font = font(size); }
  g.fillStyle = '#fff'; g.fillText(n.name, w / 2, 42);
  n.sp.forEach(function (s, i) {
    var top = 76 + i * rowH, col = ponCol(s.pon), name = s.pon >= 0 ? D.pons[s.pon].id : 'No PON';
    g.font = font(30, 700); var cw = Math.max(120, g.measureText(name).width + 28);
    g.fillStyle = col[1]; g.beginPath(); if (g.roundRect) g.roundRect(16, top, cw, 48, 10); else g.rect(16, top, cw, 48); g.fill();
    g.fillStyle = col[2]; g.textAlign = 'center'; g.fillText(name, 16 + cw / 2, top + 25);
    g.textAlign = 'left'; var cx = 16 + cw + 14; g.fillStyle = '#fff'; g.font = font(32, 700);
    var ratio = s.ratio + (s.stage ? ' S' + s.stage : ''); g.fillText(ratio, cx, top + 25); cx += g.measureText(ratio).width + 16;
    var free = s.outs.filter(function (o) { return o[1] === 0; }).length;
    g.fillStyle = free <= 0 ? '#f87171' : free / s.outs.length < 0.2 ? '#fbbf24' : '#4ade80'; var ft = free + ' free'; g.fillText(ft, cx, top + 25); cx += g.measureText(ft).width + 16;
    if (s.in !== null && s.out !== null) { g.fillStyle = '#7dd3fc'; g.font = font(26); var lv = (s.in > 0 ? '+' : '') + s.in.toFixed(1) + ' → ' + s.out.toFixed(1) + ' dBm'; if (g.measureText(lv).width <= w - cx - 14) g.fillText(lv, cx, top + 26); }
    var nn = Math.min(32, s.outs.length), gap = 6, sq = Math.min(30, (w - 32 - (nn - 1) * gap) / Math.max(1, nn));
    s.outs.slice(0, nn).forEach(function (o, k) { g.fillStyle = o[1] === 1 ? col[1] : o[1] === 2 ? '#dc2626' : '#e2e8f0'; g.fillRect(16 + k * (sq + gap), top + 62, sq, 26); });
  });
  return c;
}
D.nodes.forEach(function (n) {
  if (n.type === 'OLT') { label('OLT hub · ' + n.name, n.x, n.n, 4.4, 1.25, 'rgba(190,24,60,.92)').userData.far = 6; }
  else if (n.type === 'closure') { var cl = label('Splice closure · ' + n.name, n.x, n.n, 11, 1); cl.userData.near = 5200; cl.userData.node = n; }
  else if (n.sp.length) { var s = sprite(badge(n), n.x, n.n, n.type === 'FDT' ? 3.0 : FAT_Y + 0.8, 2.3); s.userData.near = n.type === 'FDT' ? 6500 : 900; s.userData.node = n; }
});
/* PON, size and fibers used, printed on every cable */
cables.forEach(function (c) {
  var mid = pointAt(c.path, c.cum, c.len / 2), used = c.cr.filter(function (k) { return k[3]; }).length;
  var name = c.pons.length === 1 ? D.pons[c.pons[0]].id : c.pons.length ? 'PON ' + c.pons.map(function (i) { return D.pons[i].num; }).join(', ') : 'No PON';
  var col = c.pons.length === 1 ? ponCol(c.pons[0]) : ['', '#0f2a4a', '#fff'];
  var s = label(name + ' · ' + c.cores + 'F ' + used + '/' + c.cores + ' used' + (c.std ? ' · ' + c.std : ''), mid.x, -mid.z, mid.y + 0.8, 0.8, col[1], col[2]);
  s.userData.near = c.kind === 'dist' ? 700 : 4200; s.userData.cable = c;
});

/* ---------- city context (stylised, generated, approximate) ---------- */
var city = new THREE.Group(); city.visible = false; scene.add(city);
(function cityContext() {
  function at(lat, lng) { return toScene(lat, lng); }
  function cl(text, x, n, h, bg) { var s = label(text, x, n, h, 1.1, bg); scene.remove(s); city.add(s); s.userData.keep = true; return s; }
  function ribbonMesh(pts, w, y, color) {
    var pos = [], idx = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b.x - a.x, dn = b.n - a.n, L = Math.hypot(dx, dn) || 1, px = -dn / L * w / 2, pn = dx / L * w / 2, base = pos.length / 3;
      pos.push(pts[i].x + px, y, -(pts[i].n + pn), pts[i].x - px, y, -(pts[i].n - pn));
      if (i) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide }));
  }
  var river = [[16.5230, 80.5700], [16.5140, 80.5900], [16.5062, 80.6050], [16.4990, 80.6230], [16.4900, 80.6420], [16.4800, 80.6620], [16.4720, 80.6850]].map(function (p) { return at(p[0], p[1]); });
  city.add(ribbonMesh(river, 1100, 0.2, 0x3f7fb8));
  var bar = at(16.5062, 80.6050), dir = Math.atan2(river[3].x - river[1].x, river[3].n - river[1].n) + Math.PI / 2;
  var deck = new THREE.Mesh(new THREE.BoxGeometry(1200, 6, 22), lam(0xc9c4b8)); deck.position.copy(P(bar.x, bar.n, 16)); deck.rotation.y = -dir + Math.PI / 2; city.add(deck);
  for (var i = -11; i <= 11; i++) { box(deck, 8, 16, 26, lam(0xa9a497), i * 50, -8, 0); box(deck, 40, 9, 2, lam(0x39608a), i * 50 + 25, -9, 8); }
  cl('Prakasam Barrage (approx.)', bar.x, bar.n, 60); cl('Krishna river (approx.)', river[4].x, river[4].n, 30, 'rgba(30,90,150,.85)');
  var hill = at(16.5152, 80.6058);
  var mound = new THREE.Mesh(new THREE.ConeGeometry(520, 190, 9, 1), lam(0x7d7a63)); mound.position.copy(P(hill.x, hill.n, 95)); city.add(mound);
  var y = 190; [[60, 26], [46, 22], [34, 20], [22, 18], [12, 16]].forEach(function (t) { var b = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[1], t[0] * 0.7), lam(0xe9c46a)); b.position.copy(P(hill.x, hill.n, y + t[1] / 2)); city.add(b); y += t[1]; });
  cl('Kanaka Durga temple, Indrakeeladri (approx.)', hill.x, hill.n, y + 40);
  var st = at(16.5183, 80.6194);
  var hall = new THREE.Mesh(new THREE.BoxGeometry(260, 16, 46), lam(0xb9a48a)); hall.position.copy(P(st.x, st.n, 8)); city.add(hall);
  var roofS = new THREE.Mesh(new THREE.BoxGeometry(280, 3, 60), lam(0x7a2e2e)); roofS.position.copy(P(st.x, st.n, 17.5)); city.add(roofS);
  city.add(ribbonMesh([at(16.5183, 80.5950), at(16.5183, 80.6194), at(16.5200, 80.6500), at(16.5260, 80.6850)], 14, 0.3, 0x4a4038));
  cl('Vijayawada Junction (approx.)', st.x, st.n, 50);
  var wc = document.createElement('canvas'); wc.width = 64; wc.height = 128; var wg = wc.getContext('2d'); wg.fillStyle = '#8b98a6'; wg.fillRect(0, 0, 64, 128); var rr = rng(7);
  for (var yy = 4; yy < 124; yy += 10) for (var xx = 4; xx < 60; xx += 10) { wg.fillStyle = rr() < 0.35 ? '#ffe9a8' : '#31465c'; wg.fillRect(xx, yy, 6, 6); }
  var wt = srgb(new THREE.CanvasTexture(wc)); wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
  var benz = at(16.4982, 80.6558), r2 = rng(99);
  for (var k = 0; k < 26; k++) {
    var h = 40 + r2() * 110, w = 26 + r2() * 26, ang = r2() * Math.PI * 2, dist = 90 + r2() * 520, tex = wt.clone(); tex.needsUpdate = true; tex.repeat.set(Math.round(w / 9), Math.round(h / 12));
    var tw = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + r2() * 0.5)), new THREE.MeshLambertMaterial({ map: tex })); tw.position.copy(P(benz.x + Math.cos(ang) * dist, benz.n + Math.sin(ang) * dist, h / 2)); city.add(tw);
  }
  var fly = new THREE.Mesh(new THREE.BoxGeometry(700, 2.4, 20), lam(0xb8b5ac)); fly.position.copy(P(benz.x, benz.n, 13)); fly.rotation.y = 0.5; city.add(fly);
  for (var p = -6; p <= 6; p++) box(fly, 4, 12, 10, lam(0xa09d94), p * 52, -7, 0);
  [-1, 1].forEach(function (sd) { box(fly, 700, 1.6, 0.8, lam(0x8f8c84), 0, 2, sd * 9.6); });
  cl('Benz Circle flyover (approx.)', benz.x, benz.n, 70);
})();
[['Benz Circle', 16.4982, 80.6558], ['Prakasam Barrage, Krishna river', 16.5062, 80.6050], ['Kanaka Durga temple, Indrakeeladri', 16.5152, 80.6058], ['Vijayawada Junction railway station', 16.5183, 80.6194], ['Labbipet', 16.5035, 80.6378], ['Governorpet', 16.51625, 80.61597]].forEach(function (l) {
  var li = document.createElement('li'); li.textContent = l[0] + ': ' + l[1].toFixed(4) + '° N, ' + l[2].toFixed(4) + '° E (approx.)'; document.getElementById('lm').appendChild(li);
});
