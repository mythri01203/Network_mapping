/* ============================================================================================
   Vijayawada FTTH digital twin. One file, Three.js r128, no map service: everything in the
   scene is generated from the network data below (exported from the FiberGIS database).
   Scene units are metres. x = east, y = up, -z = north.
   ============================================================================================ */
var D = /*__DATA__*/ null;
if (!D) throw new Error('The digital twin has no network data.');

/* three.js r128 (the standalone page) and the app's newer three.js differ in two places:
   how a texture is marked as sRGB, and the unit of light intensity. */
var NEW_THREE = Number(THREE.REVISION) >= 155;
var LIGHT_K = NEW_THREE ? Math.PI : 1;
function srgb(t) { if (NEW_THREE) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; }

/* ---------- coordinates ---------- */
var LAT0 = D.anchor.lat, LNG0 = D.anchor.lng;
var M_LAT = 111320, M_LNG = 111320 * Math.cos(LAT0 * Math.PI / 180);
function P(x, northing, height) { return new THREE.Vector3(x, height, -northing); }
function gpsOf(x, northing) { return { lat: LAT0 + northing / M_LAT, lng: LNG0 + x / M_LNG }; }
function gpsText(x, northing) { var g = gpsOf(x, northing); return g.lat.toFixed(5) + '° N, ' + g.lng.toFixed(5) + '° E'; }
function toScene(lat, lng) { return { x: (lng - LNG0) * M_LNG, n: (lat - LAT0) * M_LAT }; }
var NEAR_VJA = Math.hypot((LAT0 - 16.5062) * M_LAT, (LNG0 - 80.648) * M_LNG) < 15000;
function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

/* ---------- colour codes ----------
   TIA-598 order. Used for a PON port's map colour (PON 1 blue, 2 orange...) and for the colour
   code of a splitter output (output 1 blue, 2 orange...). The colour of a fiber inside a cable
   comes from the cable record itself. */
var TIA = [['Blue', '#1d6fe0', '#fff'], ['Orange', '#f97316', '#fff'], ['Green', '#16a34a', '#fff'], ['Brown', '#92400e', '#fff'], ['Slate', '#64748b', '#fff'], ['White', '#e2e8f0', '#0f172a'], ['Red', '#dc2626', '#fff'], ['Black', '#1e293b', '#fff'], ['Yellow', '#eab308', '#0f172a'], ['Violet', '#7c3aed', '#fff'], ['Rose', '#ec4899', '#fff'], ['Aqua', '#06b6d4', '#0f172a']];
function tia(n) { return TIA[(((n - 1) % 12) + 12) % 12]; }
function hexNum(h) { return parseInt(String(h).replace('#', ''), 16); }
function ponCol(pi) { return pi >= 0 && D.pons[pi] ? tia(D.pons[pi].num) : ['None', '#94a3b8', '#0f172a']; }
function chip(text, c) { return '<span class="chip" style="background:' + c[1] + ';color:' + c[2] + '">' + esc(text) + '</span>'; }
function sw(hex) { return '<span class="sw" style="background:' + hex + '"></span>'; }
function dbm(v) { return v === null || v === undefined ? 'not calculated' : (v > 0 ? '+' : '') + v.toFixed(1) + ' dBm'; }

/* ---------- data model ---------- */
var YEAR_NOW = D.yearNow;
var HEIGHT = { feeder: 9.0, branch: 8.3, dist: 7.6 };
var RADIUS = { feeder: 0.11, branch: 0.09, dist: 0.07, drop: 0.028 };   // about four times real; from far away a thin line stands in
var nodes = {};
D.nodes.forEach(function (n) { nodes[n.id] = n; n.free = 0; n.tot = 0; n.sp.forEach(function (s) { s.outs.forEach(function (o) { n.tot++; if (o[1] === 0) n.free++; }); }); });
var cables = D.cables.map(function (c) { return { id: c.id, name: c.name, kind: c.kind, cores: c.cores, std: c.std, year: c.year, mount: c.mount, cond: c.cond, from: c.from, to: c.to, pons: c.pons, cr: c.cr, pts: c.pts, cut: null }; });
var cableById = {}, cableInto = {};
cables.forEach(function (c) { cableById[c.id] = c; if (c.to) cableInto[c.to] = c; });
cables.forEach(function (c) { c.parent = c.from ? (cableInto[c.from] || null) : null; });
var customers = D.customers.map(function (c, i) { return { i: i, id: c.id, name: c.name, area: c.area, status: c.st ? 'active' : 'inactive', status0: c.st ? 'active' : 'inactive', stn: c.stn, plan: c.plan, onu: c.onu, rx: c.rx, pi: c.pi, x: c.x, n: c.n, fat: c.fat, op: c.op, fdt: c.fdt, fo: c.fo, dc: c.dc, df: c.df, dropYear: c.dy }; });
var fats = D.nodes.filter(function (n) { return n.type === 'FAT'; }), fdts = D.nodes.filter(function (n) { return n.type === 'FDT'; });
var oltNode = D.nodes.filter(function (n) { return n.type === 'OLT'; })[0];

/* a cable hangs between its attachment points */
function sagPath(pts, h, aerial) {
  var out = [];
  for (var i = 0; i < pts.length - 1; i++) {
    var a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var steps = Math.max(1, Math.ceil(L / 9)), sag = aerial ? Math.min(1.6, 0.3 + 0.012 * L) : 0;
    for (var k = 0; k < steps; k++) { var t = k / steps; out.push(P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (aerial ? h : 0.35) - sag * 4 * t * (1 - t))); }
  }
  var e = pts[pts.length - 1]; out.push(P(e[0], e[1], aerial ? h : 0.35));
  return out;
}
function cumulative(path) { var cum = [0]; for (var i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1])); return cum; }
function pointAt(path, cum, s, target) {
  target = target || new THREE.Vector3();
  if (s <= 0) return target.copy(path[0]);
  var last = cum[cum.length - 1]; if (s >= last) return target.copy(path[path.length - 1]);
  var lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  return target.copy(path[lo]).lerp(path[hi], (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1));
}
function slicePath(path, cum, a, b) {
  var out = [pointAt(path, cum, a)];
  for (var i = 0; i < path.length; i++) if (cum[i] > a && cum[i] < b) out.push(path[i]);
  out.push(pointAt(path, cum, b));
  return out;
}
/* How a cable really arrives at a piece of equipment, from the equipment outwards up to the
   pole line at height h: into the top of a terminal box, up the riser behind a cabinet, out of
   the bottom ports of a closure, or from the ODF in the rack along the ladder and up the riser
   pole outside the OLT room. `slot` spreads several cables at one box side by side. */
var FAT_Y = 5.7;
function approach(node, h, slot) {
  if (!node) return [];
  var x = node.x, z = -node.n, o = slot * 0.07, V = function (a, b, c) { return new THREE.Vector3(a, b, c); };
  if (node.type === 'FAT') return [V(x - 0.45 + o, FAT_Y + 0.5, z + 0.36), V(x - 0.45 + o, FAT_Y + 1.0, z + 0.2), V(x - 0.2, h - 0.5, z)];
  if (node.type === 'FDT') return [V(x + 0.45 + o, 2.62, z - 0.2), V(x + 0.45 + o, 3.3, z - 0.62), V(x + 0.45 + o, h - 0.7, z - 0.62), V(x + 0.3, h - 0.15, z - 0.3)];
  if (node.type === 'closure') return [V(x + 0.7 + o, 6.72, z + o), V(x + 0.62 + o, 6.3, z), V(x + 0.3, 6.6, z), V(x + 0.14, h - 0.4, z)];
  if (node.type === 'OLT') return [V(x - 0.2 + o, 2.45, z - 1.55), V(x - 0.2 + o, 3.08, z - 1.4), V(x - 3.2, 3.08, z - 1.4 + o), V(x - 3.85, 3.2, z - 1.4 + o), V(x - 3.85, h - 0.6, z - 1.4 + o), V(x - 3.2, h - 0.1, z - 1.0)];
  return [];
}
var slotAt = {};
function nextSlot(id) { slotAt[id] = (slotAt[id] || 0) + 1; return slotAt[id] - 1 - 3; }
cables.forEach(function (c) {
  var h = HEIGHT[c.kind], aerial = c.mount !== 'underground';
  var a = aerial ? approach(nodes[c.from], h, nextSlot(c.from)) : [], b = aerial ? approach(nodes[c.to], h, nextSlot(c.to)).reverse() : [];
  c.path = a.concat(sagPath(c.pts, h, aerial), b); c.cum = cumulative(c.path); c.len = c.cum[c.cum.length - 1];
});
function upstreamLength(c) { var s = 0; for (var p = c.parent; p; p = p.parent) s += p.len; return s; }
customers.forEach(function (c) { var f = nodes[c.fat]; c.dropLen = f ? Math.hypot(c.x - f.x, c.n - f.n) : 0; c.feed = cableInto[c.fat] || null; });

/* ---------- impact analysis: pure functions ---------- */
/* The first cut between the OLT and the far end of `cable` (the cable itself included), or null. */
function cutBefore(cable) {
  var chain = []; for (var c = cable; c; c = c.parent) chain.unshift(c);
  for (var i = 0; i < chain.length; i++) if (chain[i].cut !== null) return { cable: chain[i], at: chain[i].cut };
  return null;
}
/* 'inactive' | 'active' | 'affected' for one customer */
function reach(customer) {
  if (customer.status === 'inactive') return 'inactive';
  if (!customer.feed) return 'affected';
  return cutBefore(customer.feed) ? 'affected' : 'active';
}
function litLength(c) { if (c.parent && cutBefore(c.parent)) return 0; return c.cut !== null ? c.cut : c.len; }
function otdrDistance(c) { return upstreamLength(c) + (c.cut || 0); }
function counts() { var r = { active: 0, inactive: 0, affected: 0 }; customers.forEach(function (c) { r[reach(c)]++; }); return r; }
function affectedBy(cable) { var n = 0; customers.forEach(function (c) { if (c.status !== 'inactive') for (var k = c.feed; k; k = k.parent) if (k === cable) { n++; break; } }); return n; }
function nodeLit(n) { if (n.type === 'OLT') return true; var feed = cableInto[n.id]; return !!feed && !cutBefore(feed); }

/* ---------- what is shown: the selection ---------- */
var F = { pon: -1, cust: 'all', kinds: { feeder: true, branch: true, dist: true, drop: true }, freeOnly: false, labels: true };
function showCustomerF(c) { return (F.pon < 0 || c.pi === F.pon) && (F.cust === 'all' || c.state === F.cust); }
function showCableF(c) { return F.kinds[c.kind] && (F.pon < 0 || c.pons.indexOf(F.pon) >= 0); }
function showNodeF(n) { if (n.type === 'OLT') return true; if (F.pon >= 0 && n.pons.indexOf(F.pon) < 0) return false; if (F.freeOnly && (n.type === 'FAT' || n.type === 'FDT') && n.free <= 0) return false; return true; }
