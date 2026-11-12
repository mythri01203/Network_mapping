/* ---------- light pulses ---------- */
var PULSE_MAX = 0; cables.forEach(function (c) { PULSE_MAX += Math.max(1, Math.round(c.len / 45)); }); PULSE_MAX += customers.length;
var pulseMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), PULSE_MAX);
pulseMesh.frustumCulled = false; scene.add(pulseMesh);
var pulses = [], SPEED_UP = 3;
function buildPulses() {
  pulses = [];
  if (view === 'live') {
    cables.forEach(function (c) { if (!showCableF(c)) return; var L = litLength(c); if (L < 2) return; var n = Math.max(1, Math.round(L / 45)); for (var i = 0; i < n; i++) pulses.push({ path: c.path, cum: c.cum, len: L, off: i * L / n, speed: 22 * SPEED_UP, r: c.kind === 'dist' ? 0.16 : 0.22 }); });
    if (F.kinds.drop) customers.forEach(function (c) { if (c.state === 'active' && c.dropPath && showCustomerF(c)) pulses.push({ path: c.dropPath, cum: c.dropCum, len: c.dropCum[2], off: (c.i * 7.3) % c.dropCum[2], speed: 9, r: 0.07 }); });
  }
  pulseMesh.count = pulses.length;
}

/* ---------- cut markers ---------- */
var markers = [];
function buildMarkers() {
  markers.forEach(function (m) { scene.remove(m.g); }); markers = [];
  cables.forEach(function (c) {
    if (c.cut === null) return;
    var g = new THREE.Group(); g.position.copy(pointAt(c.path, c.cum, c.cut));
    var ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.3, 8, 28), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, depthTest: false })); ring.renderOrder = 9; g.add(ring);
    var sparks = []; for (var i = 0; i < 4; i++) { var s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), glow(0xffa726)); g.add(s); sparks.push(s); }
    scene.add(g); markers.push({ g: g, ring: ring, sparks: sparks });
  });
}

/* ---------- the fiber picture of a selected cable: one dot per fiber, in its recorded colour ---------- */
var coreSprite = null;
function showCores(c, at) {
  if (coreSprite) { scene.remove(coreSprite); labels.splice(labels.indexOf(coreSprite), 1); coreSprite = null; }
  if (!c || !c.cr.length) return;
  var n = c.cr.length, per = Math.min(12, n), rowsN = Math.ceil(n / per), cell = 56, w = Math.max(430, per * cell + 24), h = rowsN * cell + 70, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  var g = cv.getContext('2d'); g.fillStyle = 'rgba(13,20,30,.94)'; g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, h - 4, 16); else g.rect(2, 2, w - 4, h - 4); g.fill();
  g.fillStyle = '#fff'; g.font = '600 24px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(c.id + ' · ' + c.cores + 'F · ringed = in use', 14, 28);
  c.cr.forEach(function (k, i) {
    var x = 12 + (i % per) * cell + cell / 2, y = 56 + Math.floor(i / per) * cell + cell / 2;
    g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fillStyle = k[2] || '#94a3b8'; g.globalAlpha = k[3] ? 1 : 0.45; g.fill(); g.globalAlpha = 1;
    if (k[3]) { g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); }
    g.font = '700 18px system-ui, sans-serif'; g.textAlign = 'center'; g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3; g.strokeText(String(k[0]), x, y + 1); g.fillStyle = '#fff'; g.fillText(String(k[0]), x, y + 1); g.textAlign = 'left';
  });
  var p = pointAt(c.path, c.cum, at !== undefined ? at : c.len / 2);
  coreSprite = sprite(cv, p.x, -p.z, p.y + 2.4, 3.2); coreSprite.userData.keep = true;
}

/* ---------- state refresh: everything that shows status or the selection ---------- */
var PALE_ROOF = 0xb9bec4, PALE_WALL = 0xc9ccd0;
function refresh() {
  customers.forEach(function (c) { c.state = reach(c); });
  var col = dropMesh.geometry.attributes.color, lcol = dropLines.geometry.attributes.color;
  customers.forEach(function (c, i) {
    var on = showCustomerF(c);
    hBody.setColorAt(i, tmpC.setHex(on ? c.wall : PALE_WALL)); hRoof.setColorAt(i, tmpC.setHex(on ? ROOF[c.state] : PALE_ROOF)); hLed.setColorAt(i, tmpC.setHex(on ? LEDC[c.state] : 0x55595e));
    /* a drop takes the colour code of its splitter output while it carries light */
    if (!on) tmpC.setHex(0x9aa0a6); else if (c.state === 'active') tmpC.set(c.op ? tia(c.op)[1] : '#2e9d4f'); else tmpC.setHex(c.state === 'inactive' ? 0x6b7280 : 0xd43a2f);
    var r = dropRanges[i]; for (var v = r[0]; v < r[0] + r[1]; v++) col.setXYZ(v, tmpC.r, tmpC.g, tmpC.b);
    for (var k = 0; k < 4; k++) lcol.setXYZ(i * 4 + k, tmpC.r, tmpC.g, tmpC.b);
  });
  hBody.instanceColor.needsUpdate = true; hRoof.instanceColor.needsUpdate = true; hLed.instanceColor.needsUpdate = true; col.needsUpdate = true; lcol.needsUpdate = true;
  dropMesh.visible = dropLines.visible = F.kinds.drop;
  cables.forEach(function (c) { if (!c.group || c.builtCut !== c.cut) buildCable(c); paintCable(c); });
  /* terminal boxes: body, status light and every output */
  fats.forEach(function (n) {
    var on = showNodeF(n), lit = nodeLit(n), pi = n.portBase;
    fatBody.setColorAt(n.idx, tmpC.setHex(on ? 0xe4e7e9 : 0xb7bcc1)); fatLed.setColorAt(n.idx, tmpC.setHex(!on ? 0x55595e : lit ? 0x2bff72 : 0xff2a2a));
    n.sp.forEach(function (s) { s.outs.forEach(function (o) {
      fatPort.setColorAt(pi, tmpC.setHex(0x2b2f33));
      fatPlug.setColorAt(pi, tmpC.set(!on ? '#9aa0a6' : o[1] === 1 ? tia(o[0])[1] : o[1] === 0 ? '#f8fafc' : '#dc2626'));
      pi++;
    }); });
  });
  if (fats.length) { fatBody.instanceColor.needsUpdate = true; fatLed.instanceColor.needsUpdate = true; }
  if (fatPortN) { fatPort.instanceColor.needsUpdate = true; fatPlug.instanceColor.needsUpdate = true; }
  fdts.forEach(function (n) { fdtPorts[n.id].forEach(function (p) { p.plug.material.color.set(p.out[1] === 1 ? tia(p.out[0])[1] : p.out[1] === 0 ? '#f8fafc' : '#dc2626'); p.plug.scale.z = p.out[1] === 1 ? 1 : 0.35; }); });
  leds.forEach(function (l) { if (l.kind === 'box') { l.lit = nodeLit(l.node); l.mesh.material.color.setHex(l.lit ? 0x2bff72 : 0xff2a2a); } });
  buildPulses(); buildMarkers();
  var all = counts(), n = all, used = 0, free = 0;
  fats.forEach(function (f) { if (F.pon >= 0 && f.pons.indexOf(F.pon) < 0) return; used += f.tot - f.free; free += f.free; });
  if (F.pon >= 0) { n = { active: 0, inactive: 0, affected: 0 }; customers.forEach(function (c) { if (c.pi === F.pon) n[c.state]++; }); }
  document.getElementById('nAct').textContent = n.active; document.getElementById('nIna').textContent = n.inactive; document.getElementById('nAff').textContent = n.affected;
  document.getElementById('nUsed').textContent = used; document.getElementById('nFree').textContent = free;
  var cuts = cables.filter(function (c) { return c.cut !== null; }), b = document.getElementById('banner');
  if (cuts.length) {
    var c0 = cuts[0]; b.className = 'bad';
    b.textContent = 'Fiber cut on ' + c0.id + ' (' + c0.name + '), OTDR fault at ' + Math.round(otdrDistance(c0)) + ' m from OLT (installed ' + c0.year + ', condition ' + c0.cond + '). ' + all.affected + ' customers affected.' + (cuts.length > 1 ? ' ' + (cuts.length - 1) + ' more cut' + (cuts.length > 2 ? 's' : '') + '.' : '');
  } else { b.className = 'ok'; b.textContent = 'No fiber cut. Light reaches every box. ' + all.active + ' customers in service, ' + all.inactive + ' inactive.'; }
  legend(); ponList(); freeList();
}
function legend() {
  var items = view === 'age'
    ? [['#22c55e', 'Cable 0 to 3 years'], ['#f59e0b', '4 to 8 years'], ['#f0552b', 'Over 8 years (old)']]
    : [['#ffc233', 'Feeder carrying several PONs'], ['#33383e', 'Dark fiber (cut, or below a cut)']];
  items = items.concat([['#2e9d4f', 'Roof: active'], ['#8b929a', 'Roof: inactive'], ['#d43a2f', 'Roof: service affected'], ['#f8fafc', 'Box output: free'], ['#1d6fe0', 'Box output in use, in its colour code (1 blue, 2 orange, 3 green…)']]);
  document.getElementById('legend').innerHTML = items.map(function (i) { return '<span><i style="background:' + i[0] + '"></i>' + i[1] + '</span>'; }).join('') + '<span>Branch and distribution fibers take their PON port\'s colour (see the PON list). Power levels are calculated, not measured.</span>';
}

/* ---------- side panel: PON list, free places, search ---------- */
function ponList() {
  var h = '<button class="pon' + (F.pon < 0 ? ' on' : '') + '" data-act="setPon" data-arg="-1"><div class="top"><b>All PON ports</b><span class="muted">' + customers.length + ' customers</span></div></button>';
  D.pons.forEach(function (p, i) {
    var st = { active: 0, inactive: 0, affected: 0 }; customers.forEach(function (c) { if (c.pi === i) st[c.state]++; });
    h += '<button class="pon' + (F.pon === i ? ' on' : '') + '" data-act="setPon" data-arg="' + i + '"><div class="top"><span>' + chip(p.id, ponCol(i)) + ' <b>' + esc(p.area) + '</b></span><span class="' + (p.free > 0 ? 'free' : 'muted') + '">' + p.free + ' free</span></div>'
      + '<div class="st">' + esc(p.streets.join(', ')) + '</div>'
      + '<div class="st">' + st.active + ' active · ' + st.inactive + ' inactive' + (st.affected ? ' · <b style="color:#dc2626">' + st.affected + ' affected</b>' : '') + ' · ' + p.used + '/' + p.tot + ' outputs used</div>'
      + '<div class="st">Launch ' + dbm(p.tx) + (p.rx ? ' · at homes ' + p.rx[0].toFixed(1) + ' to ' + p.rx[1].toFixed(1) + ' dBm' : '') + '</div></button>';
  });
  document.getElementById('ponList').innerHTML = h;
}
function freeList() {
  var list = fats.concat(fdts).filter(function (n) { return n.free > 0 && (F.pon < 0 || n.pons.indexOf(F.pon) >= 0); }).sort(function (a, b) { return b.free - a.free || a.name.localeCompare(b.name); });
  document.getElementById('freeList').innerHTML = list.length
    ? '<table>' + list.map(function (n) { return '<tr class="link" data-act="goNode" data-arg="' + n.id + '"><td>' + n.pons.map(function (i) { return chip(D.pons[i].id, ponCol(i)); }).join(' ') + '</td><td>' + esc(n.name) + '</td><td class="free">' + n.free + ' free of ' + n.tot + '</td></tr>'; }).join('') + '</table>'
    : '<span class="note">No free splitter output' + (F.pon >= 0 ? ' on this PON port.' : '.') + '</span>';
}
var ACT = {};
ACT.setPon = function (i) {
  i = Number(i);
  F.pon = i; refresh();
  if (i < 0) { camOverview(); return; }
  var b = { x0: 1e9, x1: -1e9, n0: 1e9, n1: -1e9 }; customers.forEach(function (c) { if (c.pi === i) { b.x0 = Math.min(b.x0, c.x); b.x1 = Math.max(b.x1, c.x); b.n0 = Math.min(b.n0, c.n); b.n1 = Math.max(b.n1, c.n); } });
  if (b.x0 > b.x1) return;
  var cx = (b.x0 + b.x1) / 2, cn = (b.n0 + b.n1) / 2, sp = Math.max(160, b.x1 - b.x0, b.n1 - b.n0);
  flyTo(P(cx, cn, 0), P(cx, cn - sp * 0.8, sp * 0.9));
};
ACT.goNode = function (id) { var n = nodes[id]; if (!n) return; showNode(n); if (n.type === 'FAT') flyTo(P(n.x, n.n - 0.4, FAT_Y - 0.2), P(n.x + 1.6, n.n - 5.5, FAT_Y + 1.2)); else flyTo(P(n.x, n.n, 1.6), P(n.x + 1.5, n.n - 5.5, 2.6)); };
ACT.goCustomer = function (i) { var c = customers[Number(i)]; showCustomer(c); flyTo(P(c.x, c.n, 3), P(c.x + Math.sin(c.yaw) * 26 + 8, c.n - Math.cos(c.yaw) * 26, 16)); };
document.getElementById('q').addEventListener('input', function () {
  var q = this.value.trim().toLowerCase(), out = document.getElementById('qr'); if (q.length < 2) { out.innerHTML = ''; return; }
  var hits = [];
  customers.forEach(function (c) { if (hits.length < 8 && (c.id.toLowerCase().indexOf(q) >= 0 || c.name.toLowerCase().indexOf(q) >= 0)) hits.push('<tr class="link" data-act="goCustomer" data-arg="' + c.i + '"><td>House</td><td>' + esc(c.id) + ' · ' + esc(c.name) + '</td></tr>'); });
  D.nodes.forEach(function (n) { if (hits.length < 14 && n.type !== 'OLT' && (n.id.toLowerCase().indexOf(q) >= 0 || n.name.toLowerCase().indexOf(q) >= 0)) hits.push('<tr class="link" data-act="goNode" data-arg="' + n.id + '"><td>' + (n.type === 'closure' ? 'Closure' : n.type) + '</td><td>' + esc(n.name) + '</td></tr>'); });
  out.innerHTML = hits.length ? '<table>' + hits.join('') + '</table>' : 'Nothing found.';
});

/* ---------- info panel ---------- */
var selected = null;
function rows(list) { return '<dl>' + list.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; }
function tag(text, color) { return '<span class="tag" style="background:' + color + '">' + esc(text) + '</span>'; }
function show(title, html) { document.getElementById('pTitle').textContent = title; var b = document.getElementById('pBody'); b.innerHTML = html; b.className = ''; }
var KIND = { feeder: 'Feeder (trunk)', branch: 'Branch', dist: 'Distribution' };
var STC = { active: '#16a34a', inactive: '#64748b', affected: '#dc2626' }, STN = { active: 'Active', inactive: 'Inactive', affected: 'Service affected' };
function showCable(c, at) {
  selected = { type: 'cable', cable: c, at: at }; showCores(c, at);
  var up = c.parent ? cutBefore(c.parent) : null, mid = pointAt(c.path, c.cum, at !== undefined ? at : c.len / 2), used = c.cr.filter(function (k) { return k[3]; }).length;
  var status = c.cut !== null ? tag('CUT at ' + Math.round(c.cut) + ' m', '#dc2626') : up ? tag('Dark: cut upstream on ' + up.cable.id, '#64748b') : tag('Lit', '#16a34a');
  var btn = c.cut !== null ? '<button class="good" data-act="restoreCable" data-arg="' + c.id + '">Restore cable</button>'
    : '<button class="danger" data-act="cutCable" data-arg="' + c.id + '|' + (at !== undefined ? at.toFixed(1) : (c.len / 2).toFixed(1)) + '">Cut here (' + Math.round(upstreamLength(c) + (at !== undefined ? at : c.len / 2)) + ' m from OLT)</button>';
  var cores = '<h2 style="margin-top:10px">Fibers in this cable: ' + used + ' in use, <span class="free">' + (c.cr.length - used) + ' free</span></h2><div class="scroll"><table><tr><th>No.</th><th>Colour</th><th>State</th><th>Carries</th></tr>'
    + c.cr.map(function (k) { return '<tr><td>' + k[0] + '</td><td>' + sw(k[2] || '#94a3b8') + esc(k[1] || 'not recorded') + '</td><td>' + (k[3] ? 'In use' : '<span class="free">FREE</span>') + '</td><td>' + esc(k[4] || '') + '</td></tr>'; }).join('') + '</table></div>';
  show(c.id + ' · ' + c.name, rows([
    ['Kind', KIND[c.kind]], ['Fiber type', c.cores + ' fibers' + (c.std ? ' · ' + esc(c.std) : '')], ['PON ports on it', c.pons.length ? c.pons.map(function (i) { return chip(D.pons[i].id, ponCol(i)) + ' ' + esc(D.pons[i].area); }).join(' &nbsp; ') : 'none'],
    ['Mount', esc(c.mount)], ['Installed', c.year + ' (' + (YEAR_NOW - c.year) + ' years old)'], ['Condition', esc(c.cond)], ['Length', Math.round(c.len) + ' m (drawn route)'],
    ['From → to', esc((nodes[c.from] || {}).name || '?') + ' → ' + esc((nodes[c.to] || {}).name || '?')], ['GPS (clicked point)', gpsText(mid.x, -mid.z)], ['Customers downstream', affectedBy(c) + ' in service'], ['Status', status],
  ]) + btn + cores);
}
function showCustomer(c) {
  selected = { type: 'customer', customer: c }; showCores(null);
  var st = reach(c), why = '';
  if (st === 'affected') { var cut = c.feed ? cutBefore(c.feed) : null; why = cut ? 'No light: fiber cut on ' + cut.cable.id + ', ' + Math.round(otdrDistance(cut.cable)) + ' m from the OLT' : 'No recorded fiber path to an OLT'; }
  else if (st === 'inactive') why = 'ONU off or account ' + esc(c.stn && c.status0 === 'inactive' ? c.stn : 'inactive').toLowerCase() + '. The fiber is healthy.';
  var pon = c.pi >= 0 ? D.pons[c.pi] : null, lead = c.op ? tia(c.op) : null;
  var path = (pon ? chip(pon.id, ponCol(c.pi)) : 'no PON') + (c.fdt ? ' → ' + esc(c.fdt) + (c.fo ? ' out ' + c.fo : '') : '') + ' → ' + esc((nodes[c.fat] || {}).name || 'box not recorded') + (c.op ? ' out ' + c.op + ' ' + sw(lead[1]) + lead[0] : '');
  show(c.id + ' · ' + c.name, rows([
    ['Status', tag(STN[st], STC[st])], ['Fiber path', path], ['Area', esc(c.area || 'not recorded')], ['Plan', esc(c.plan || 'not recorded')], ['ONU serial', esc(c.onu || 'not recorded')],
    ['Drop', Math.round(c.dropLen) + ' m' + (c.df ? ', ' + c.df + 'F' : '') + (c.dc ? ', fiber ' + c.dc[0] + ' ' + sw(c.dc[2] || '#94a3b8') + esc(c.dc[1]) : '') + (c.dropYear ? ', installed ' + c.dropYear : '')],
    ['GPS', gpsText(c.x, c.n)], [st === 'active' ? 'Light at the ONU (Rx)' : 'Why it is down', st === 'active' ? dbm(c.rx) + ' (calculated, not measured)' : why],
  ]) + '<button data-act="toggleCustomer" data-arg="' + c.i + '">Set ' + (c.status === 'inactive' ? 'active' : 'inactive') + '</button> <button data-act="goNode" data-arg="' + c.fat + '">Go to its box</button>');
}
function showNode(n) {
  selected = { type: 'node', node: n }; showCores(null);
  if (n.type === 'OLT') {
    var t = '<h2>PON ports</h2><div class="scroll"><table><tr><th>Port</th><th>Area and roads</th><th>Customers</th><th>Outputs</th><th>Launch</th><th>At homes (dBm)</th></tr>' + D.olt.ports.map(function (p) {
      if (p.pi < 0) return '<tr><td>' + esc(p.id) + '</td><td colspan="5" class="muted">no customers traced</td></tr>';
      var q = D.pons[p.pi], st = { active: 0, inactive: 0, affected: 0 }; customers.forEach(function (c) { if (c.pi === p.pi) st[c.state]++; });
      return '<tr class="link" data-act="setPon" data-arg="' + p.pi + '"><td>' + chip(q.id, ponCol(p.pi)) + '</td><td><b>' + esc(q.area) + '</b><br><span class="muted">' + esc(q.streets.join(', ')) + '</span></td><td>' + st.active + ' active<br>' + st.inactive + ' inactive' + (st.affected ? '<br><b style="color:#dc2626">' + st.affected + ' affected</b>' : '') + '</td><td>' + q.used + ' used<br><span class="' + (q.free ? 'free' : 'muted') + '">' + q.free + ' free</span></td><td>' + dbm(q.tx) + '</td><td>' + (q.rx ? q.rx[0].toFixed(1) + ' to ' + q.rx[1].toFixed(1) : '') + '</td></tr>';
    }).join('') + '</table></div>';
    show(n.name + ' · OLT', rows([['What it is', 'Optical line terminal: the head of the network. Each PON port lights one area.'], ['Make', esc(D.olt.make)], ['PON ports', D.olt.ports.length + ' (' + D.pons.length + ' with customers)'], ['GPS', gpsText(n.x, n.n)]]) + t);
    return;
  }
  var feed = cableInto[n.id], cut = feed ? cutBefore(feed) : null;
  var status = cut ? tag('No light: cut on ' + cut.cable.id, '#dc2626') : tag('Light present', '#16a34a');
  var body = rows([['What it is', n.type === 'closure' ? 'Splice closure: the feeder is spliced here to the branch cables.' : n.type === 'FDT' ? 'Distribution cabinet with the first splitter. It feeds the home boxes of its area.' : 'Terminal box (FAT) with the last splitter. Drops to houses start here.'],
    ['PON port', n.pons.length ? n.pons.map(function (i) { return chip(D.pons[i].id, ponCol(i)) + ' ' + esc(D.pons[i].area); }).join(' &nbsp; ') : 'none'], ['Road', esc(n.street || 'not recorded')], ['Status', status], ['Fed by', feed ? esc(feed.id + ' · ' + feed.name) : 'none'], ['GPS', gpsText(n.x, n.n)]]);
  n.sp.forEach(function (s) {
    var used = s.outs.filter(function (o) { return o[1] === 1; }).length, free = s.outs.filter(function (o) { return o[1] === 0; }).length;
    body += '<h2 style="margin-top:10px">Splitter ' + esc(s.ratio) + (s.stage ? ' (stage ' + s.stage + ')' : '') + ': ' + used + ' used, <span class="free">' + free + ' free</span> · level in ' + dbm(s.in) + ', out ' + dbm(s.out) + ' (calculated)</h2>'
      + '<div class="scroll"><table><tr><th>Out</th><th>Colour code</th><th>State</th><th>Connected to</th><th>Light (Rx)</th></tr>' + s.outs.map(function (o) {
        var c = o[2] === 'customer' ? customers[o[3]] : null, t = tia(o[0]);
        var to = c ? esc(c.id + ' · ' + c.name) + ' ' + tag(STN[c.state], STC[c.state]) : o[2] === 'box' ? esc(o[3]) : '';
        return '<tr' + (c ? ' class="link" data-act="goCustomer" data-arg="' + c.i + '"' : '') + '><td>' + o[0] + '</td><td>' + sw(t[1]) + t[0] + '</td><td>' + (o[1] === 1 ? 'In use' : o[1] === 0 ? '<span class="free">FREE: a new connection can go here</span>' : 'Faulty or reserved') + '</td><td>' + to + '</td><td>' + (c && c.state === 'active' ? dbm(c.rx) : c ? '—' : o[1] === 0 && s.out !== null ? 'about ' + dbm(s.out) + ' at the box' : '') + '</td></tr>';
      }).join('') + '</table></div>';
  });
  show(n.name + ' · ' + (n.type === 'closure' ? 'Splice closure' : n.type), body);
}
function reshow() { if (!selected) return; if (selected.type === 'cable') showCable(selected.cable, selected.at); else if (selected.type === 'customer') showCustomer(selected.customer); else showNode(selected.node); }
ACT.cutCable = function (arg) { var id = String(arg).split('|')[0], at = Number(String(arg).split('|')[1]), c = cableById[id]; c.cut = Math.max(1, Math.min(c.len - 1, at)); refresh(); reshow(); };
ACT.restoreCable = function (id) { cableById[id].cut = null; refresh(); reshow(); };
ACT.toggleCustomer = function (i) { var c = customers[Number(i)]; c.status = c.status === 'inactive' ? 'active' : 'inactive'; refresh(); reshow(); };

/* Buttons and rows made from text carry data-act / data-arg instead of inline code, so the page
   also works under a strict content security policy (inside the FiberGIS app). */
function onAct(e) {
  var el = e.target; while (el && el !== document.body && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
  if (!el || el === document.body || !el.getAttribute) return;
  var fn = ACT[el.getAttribute('data-act')]; if (fn) fn(el.getAttribute('data-arg'));
}
document.addEventListener('click', onAct);
var alive = true;
window.twin = {
  setPon: ACT.setPon, goNode: ACT.goNode, goCustomer: ACT.goCustomer,
  /* go to a record by its id (a customer, a FAT, an FDT, a closure or the OLT); false when it is not drawn */
  goId: function (id) { var c = customers.filter(function (k) { return k.id === id; })[0]; if (c) { ACT.goCustomer(c.i); return true; } if (nodes[id]) { if (nodes[id].type === 'OLT') camOlt(); else ACT.goNode(id); return true; } return false; },
  /* stops the page's loop and frees the graphics memory (the app calls this when the page closes) */
  dispose: function () { alive = false; document.removeEventListener('click', onAct); window.removeEventListener('resize', resize); controls.dispose(); renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); },
};

/* ---------- picking: a click, not a drag ---------- */
var ray = new THREE.Raycaster(), down = null;
renderer.domElement.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', function (e) {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
  down = null;
  var r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  var hits = ray.intersectObjects(pickables, false);
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i], o = h.object;
    if (o === hBody || o === hRoof) { if (h.instanceId !== undefined) { showCustomer(customers[h.instanceId]); return; } continue; }
    if (o === fatBody || o === fatLid) { if (h.instanceId !== undefined) { showNode(fats[h.instanceId]); return; } continue; }
    if (o.userData.node) { showNode(o.userData.node); return; }
    if (o.userData.cable) {
      var c = o.userData.cable; if (!c.group.visible) continue;
      var best = 0, bd = 1e9; for (var k = 0; k < c.path.length; k++) { var d = c.path[k].distanceTo(h.point); if (d < bd) { bd = d; best = c.cum[k]; } }
      showCable(c, best); return;
    }
  }
});

/* ---------- camera presets with an eased fly-to ---------- */
var fly = null;
function flyTo(target, pos) { fly = { t: 0, t0: controls.target.clone(), p0: camera.position.clone(), t1: target, p1: pos }; }
function camOverview() { flyTo(P(CX, CN, 0), P(CX, CN - SPAN * 0.75, SPAN * 0.85)); }
function camOlt() { showNode(oltNode); flyTo(rackAt.clone(), rackAt.clone().add(new THREE.Vector3(0.35, 0.2, 1.7))); }
function camFault() { var c = cables.filter(function (k) { return k.cut !== null; })[0]; if (!c) { camOverview(); return; } var at = pointAt(c.path, c.cum, c.cut); flyTo(at.clone(), at.clone().add(new THREE.Vector3(40, 45, 75))); }
function camCity() { city.visible = true; document.getElementById('bCity').className = 'on'; flyTo(P(CX - 900, CN, 0), P(CX - 900, CN - 9000, 7500)); }

/* ---------- buttons and filters ---------- */
function setView(v) { view = v; document.getElementById('bLive').className = v === 'live' ? 'on' : ''; document.getElementById('bAge').className = v === 'age' ? 'on' : ''; refresh(); }
document.getElementById('bLive').onclick = function () { setView('live'); };
document.getElementById('bAge').onclick = function () { setView('age'); };
document.getElementById('bOv').onclick = camOverview; document.getElementById('bFault').onclick = camFault; document.getElementById('bOlt').onclick = camOlt; document.getElementById('bCityCam').onclick = camCity;
document.getElementById('bCity').onclick = function () { city.visible = !city.visible; this.className = city.visible ? 'on' : ''; };
document.getElementById('bLabels').onclick = function () { F.labels = !F.labels; this.className = F.labels ? 'on' : ''; };
document.getElementById('fCust').onchange = function () { F.cust = this.value; refresh(); };
[['kFeeder', 'feeder'], ['kBranch', 'branch'], ['kDist', 'dist'], ['kDrop', 'drop']].forEach(function (k) { document.getElementById(k[0]).onchange = function () { F.kinds[k[1]] = this.checked; refresh(); }; });
document.getElementById('fFree').onchange = function () { F.freeOnly = this.checked; refresh(); };
function demoState() {
  cables.forEach(function (c) { c.cut = null; }); customers.forEach(function (c) { c.status = c.status0; });
  /* the standalone demo opens with one cut; inside the app nothing is cut until the person cuts it */
  var c = D.demoCut ? cableById[D.demoCut.id] : null; if (c) c.cut = Math.min(c.len - 1, D.demoCut.at);
}
document.getElementById('bReset').onclick = function () {
  demoState(); selected = null; showCores(null); F.pon = -1; F.cust = 'all'; F.freeOnly = false; F.kinds = { feeder: true, branch: true, dist: true, drop: true };
  document.getElementById('fCust').value = 'all'; document.getElementById('fFree').checked = false; ['kFeeder', 'kBranch', 'kDist', 'kDrop'].forEach(function (id) { document.getElementById(id).checked = true; });
  show('Click something in the scene', 'Click a cable, a house, a box or the OLT.'); document.getElementById('pBody').className = 'note'; setView('live'); camFault();
};

/* ---------- self test ---------- */
window.twinTest = function () {
  var keepCuts = cables.map(function (c) { return c.cut; }), keepSt = customers.map(function (c) { return c.status; }), out = {};
  var total = customers.length, off = customers.filter(function (c) { return c.status0 === 'inactive'; }).length;
  demoState(); out.demo = counts();
  cables.forEach(function (c) { c.cut = null; }); out.restored = counts();
  cables.filter(function (c) { return c.kind === 'feeder'; }).forEach(function (c) { c.cut = c.len / 2; }); out.allFeedersCut = counts();
  cables.forEach(function (c) { c.cut = null; }); var d = cables.filter(function (c) { return c.kind === 'dist'; })[0]; d.cut = d.len / 2; out.oneDistCut = counts(); out.oneDistServes = affectedBy(d);
  out.outputs = { used: 0, free: 0 }; fats.forEach(function (f) { out.outputs.used += f.tot - f.free; out.outputs.free += f.free; });
  out.pass = out.restored.active === total - off && out.restored.affected === 0 && out.allFeedersCut.active === 0 && out.allFeedersCut.inactive === off && out.oneDistCut.affected === out.oneDistServes && out.demo.active + out.demo.inactive + out.demo.affected === total;
  cables.forEach(function (c, i) { c.cut = keepCuts[i]; }); customers.forEach(function (c, i) { c.status = keepSt[i]; });
  return out;
};

/* ---------- resize and the frame loop ---------- */
function resize() { var w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
if (window.ResizeObserver) new ResizeObserver(function () { if (alive) resize(); }).observe(host);
var t0 = performance.now(), v3 = new THREE.Vector3(), lastBlink = -1;
function frame() {
  if (!alive) return;
  requestAnimationFrame(frame);
  var t = (performance.now() - t0) / 1000;
  if (fly) { fly.t += 1 / 45; var k = Math.min(1, fly.t), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; controls.target.lerpVectors(fly.t0, fly.t1, e); camera.position.lerpVectors(fly.p0, fly.p1, e); if (k >= 1) fly = null; }
  controls.update();
  sun.position.set(controls.target.x + 180, 420, controls.target.z + 140); sun.target.position.copy(controls.target); sun.target.updateMatrixWorld();
  var dist = camera.position.distanceTo(controls.target);
  camera.near = Math.max(0.05, dist * 0.01); camera.far = Math.max(8000, dist * 6); camera.updateProjectionMatrix();
  scene.fog.near = Math.max(2500, dist * 1.2); scene.fog.far = Math.max(16000, dist * 5);
  renderer.shadowMap.enabled = dist < 1500;
  for (var i = 0; i < pulses.length; i++) { var p = pulses[i], s = (p.off + t * p.speed) % p.len; pointAt(p.path, p.cum, s, v3); var sc = p.r * Math.max(1, dist / 110); dummy.position.copy(v3); dummy.rotation.set(0, 0, 0); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); pulseMesh.setMatrixAt(i, dummy.matrix); }
  pulseMesh.instanceMatrix.needsUpdate = true;
  leds.forEach(function (l) {
    if (l.kind === 'rack') l.mesh.material.color.setHex(Math.sin(t * 7 + l.phase) > -0.2 ? 0x2bff72 : 0x0b3a1c);
    else if (l.kind === 'pon') l.mesh.material.color.setHex(l.pi < 0 ? 0x2a2a2a : Math.sin(t * 9 + l.phase) > 0 ? 0x2bff72 : 0x0b3a1c);
    else if (!l.lit) l.mesh.material.color.setHex(Math.sin(t * 6) > 0 ? 0xff2a2a : 0x4a0d0d);
  });
  var blink = Math.floor(t * 2.5) % 2;
  if (blink !== lastBlink) { lastBlink = blink; customers.forEach(function (c, i) { if (c.state === 'affected' && showCustomerF(c)) hLed.setColorAt(i, tmpC.setHex(blink ? 0xff2a2a : 0x3a0808)); }); hLed.instanceColor.needsUpdate = true; }
  markers.forEach(function (m) { var s2 = (1 + 0.25 * Math.sin(t * 6)) * Math.max(1, dist / 180); m.ring.scale.set(s2, s2, s2); m.ring.quaternion.copy(camera.quaternion); m.sparks.forEach(function (sp, j) { sp.position.set(Math.sin(t * 9 + j * 2.1) * 1.1, Math.abs(Math.sin(t * 13 + j)) * 1.5, Math.cos(t * 7 + j * 1.3) * 1.1); sp.visible = Math.sin(t * 23 + j * 5) > -0.3; sp.scale.setScalar(Math.max(1, dist / 280)); }); });
  /* labels: a readable size, shown only when near enough and part of the current selection */
  /* inside the OLT room the rack is the subject: no floating labels over it */
  var inRoom = camera.position.distanceTo(rackAt) < 9;
  labels.forEach(function (s) {
    var u = s.userData, d = s.position.distanceTo(camera.position), hgt = THREE.MathUtils.clamp(d * 0.02, 0.3, 400) * u.size;
    s.scale.set(hgt * u.aspect, hgt, 1);
    if (u.keep) return;
    var ok = !inRoom && d < (u.near || 1e9) && d > (u.far || 3);
    if (u.node) ok = ok && F.labels && showNodeF(u.node);
    if (u.cable) ok = ok && F.labels && showCableF(u.cable) && d > 12;
    s.visible = ok;
  });
  renderer.render(scene, camera);
}

/* ---------- start ---------- */
document.getElementById('headline').textContent = (NEAR_VJA ? 'Vijayawada, NTR district, Andhra Pradesh. ' : '') + 'Model anchored at the OLT ' + D.anchor.name + ' (' + LAT0.toFixed(4) + '° N, ' + LNG0.toFixed(4) + '° E). ' + customers.length + ' mapped customers on ' + D.pons.length + ' PON ports, ' + cables.length + ' cables, ' + (fats.length + fdts.length) + ' splitter boxes, ' + D.poles.length + ' poles, from the FiberGIS database. Roads are drawn along the cable routes and are illustrative.';
document.getElementById('foot').textContent = 'Demo records exported ' + D.exported + '. No map service is used: the street layout is generated from the cable routes. Power levels are calculated from the recorded launch power and the optical settings, not measured. Boxes on poles are drawn about three times real size and cables about four times real thickness, so they can be seen; the OLT rack is real size. The rack\'s switch, power shelf and batteries are typical, not on record. Light pulses run ' + SPEED_UP + '× faster than real. The opening fault is a demonstration, not a real alarm.';
/* the landmarks are Vijayawada's: elsewhere the city context is not offered */
if (!NEAR_VJA) { ['bCity', 'bCityCam'].forEach(function (id) { document.getElementById(id).style.display = 'none'; }); document.getElementById('lmPanel').style.display = 'none'; }
demoState(); refresh();
if (!D.demoCut) document.getElementById('foot').textContent = document.getElementById('foot').textContent.replace(' The opening fault is a demonstration, not a real alarm.', ' Cuts made here are a what-if: nothing is saved to the network.');
camera.position.copy(P(CX, CN - SPAN * 0.75, SPAN * 0.85)); controls.target.copy(P(CX, CN, 0)); camFault();
frame();
