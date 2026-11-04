import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'server_data.json');
const DIST_DIR = path.resolve(__dirname, 'dist');
const MAX_BODY_BYTES = 10 * 1024 * 1024;

// Comma-separated list of origins allowed to call the API cross-origin.
// Defaults to the local Vite dev server; same-origin requests never need CORS.
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
);

// REST collection name -> db key, id prefix and server-stamped date field.
const COLLECTIONS = {
  equipment: { key: 'equipment', prefix: 'EQ', dateField: 'installedDate' },
  cables: { key: 'cables', prefix: 'CBL', dateField: 'installationDate' },
  splitters: { key: 'splitters', prefix: 'SP' },
  closures: { key: 'closures', prefix: 'JC' },
  customers: { key: 'customers', prefix: 'CUST', dateField: 'installationDate' },
  faults: { key: 'faults', prefix: 'FLT', dateField: 'reportedAt', timestamp: true },
  'work-orders': { key: 'workOrders', prefix: 'WO', dateField: 'createdAt', timestamp: true },
  zones: { key: 'zones', prefix: 'ZONE' },
  documents: { key: 'documents', prefix: 'DOC', dateField: 'uploadDate' }
};
const COLLECTION_KEYS = Object.values(COLLECTIONS).map(c => c.key);

let db = {
  equipment: [],
  cables: [],
  splitters: [],
  closures: [],
  customers: [],
  faults: [],
  workOrders: [],
  zones: [],
  documents: [],
  systemInfo: {
    name: 'FIBER-GIS Network Management Platform API',
    version: '2.1.0',
    mode: 'Combined FTTH & Cable TV HFC',
    status: 'Operational',
    startedAt: new Date().toISOString()
  }
};

if (fs.existsSync(DATA_FILE)) {
  try {
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    for (const key of COLLECTION_KEYS) {
      if (Array.isArray(stored[key])) db[key] = stored[key];
    }
    console.log('[API] Loaded persistent database from server_data.json');
  } catch {
    console.warn('[API] Could not parse server_data.json, starting with fresh store');
  }
}

function saveDb() {
  const tmp = `${DATA_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[API] Failed to persist data:', err.message);
  }
}

const today = () => new Date().toISOString().split('T')[0];

function nextId(list, prefix) {
  const taken = new Set(list.map(item => item.id));
  let n = list.length + 1;
  let id;
  do {
    id = `${prefix}-${String(n).padStart(3, '0')}`;
    n += 1;
  } while (taken.has(id));
  return id;
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Resolves a URL path inside dist/, returning null for anything that escapes it.
function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(DIST_DIR, relative);
  if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) return null;
  return resolved;
}

function serveFile(req, res, filePath) {
  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(origin && !ALLOWED_ORIGINS.has(origin) ? 403 : 204);
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  const sendJson = (statusCode, data) => {
    if (res.headersSent) return;
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const readBody = callback => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        sendJson(413, { error: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      let data;
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        data = body ? JSON.parse(body) : {};
      } catch {
        sendJson(400, { error: 'Invalid JSON payload' });
        return;
      }
      callback(data);
    });
  };

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(200, {
        status: 'UP',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        service: db.systemInfo.name,
        version: db.systemInfo.version,
        stats: {
          equipmentCount: db.equipment.length,
          cableCount: db.cables.length,
          customerCount: db.customers.length,
          faultCount: db.faults.length,
          workOrderCount: db.workOrders.length,
          zoneCount: db.zones.length
        }
      });
    }

    if (pathname === '/api/network/summary' && req.method === 'GET') {
      return sendJson(200, {
        systemInfo: db.systemInfo,
        kpis: {
          totalEquipment: db.equipment.length,
          totalCables: db.cables.length,
          totalCustomers: db.customers.length,
          activeFaults: db.faults.filter(f => f.status !== 'Resolved').length,
          activeWorkOrders: db.workOrders.filter(w => w.status !== 'Completed' && w.status !== 'Cancelled').length,
          totalZones: db.zones.length
        }
      });
    }

    if (pathname === '/api/backup' && req.method === 'GET') {
      return sendJson(200, { exportTimestamp: new Date().toISOString(), ...db });
    }

    if (pathname === '/api/restore' && req.method === 'POST') {
      return readBody(imported => {
        if (!isPlainObject(imported)) {
          return sendJson(400, { error: 'Backup payload must be a JSON object' });
        }
        const invalid = COLLECTION_KEYS.filter(key => key in imported && !Array.isArray(imported[key]));
        if (invalid.length > 0) {
          return sendJson(400, { error: `Expected arrays for: ${invalid.join(', ')}` });
        }
        const restored = COLLECTION_KEYS.filter(key => Array.isArray(imported[key]));
        if (restored.length === 0) {
          return sendJson(400, { error: 'Backup payload contains no recognised collections' });
        }
        for (const key of restored) db[key] = imported[key];
        saveDb();
        return sendJson(200, { success: true, restored, message: 'Database state restored successfully' });
      });
    }

    // Generic collection routes: /api/<collection> and /api/<collection>/<id>
    const match = pathname.match(/^\/api\/([a-z-]+)(?:\/([^/]+))?\/?$/);
    const collection = match && COLLECTIONS[match[1]];
    if (collection) {
      const list = db[collection.key];
      let itemId = null;
      if (match[2]) {
        try {
          itemId = decodeURIComponent(match[2]);
        } catch {
          return sendJson(400, { error: 'Malformed id' });
        }
      }

      if (itemId === null) {
        if (req.method === 'GET') return sendJson(200, list);
        if (req.method === 'POST') {
          return readBody(payload => {
            if (!isPlainObject(payload)) return sendJson(400, { error: 'Payload must be a JSON object' });
            const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : nextId(list, collection.prefix);
            if (list.some(item => item.id === id)) {
              return sendJson(409, { error: `A record with id ${id} already exists` });
            }
            const record = { ...payload, id };
            if (collection.dateField && !record[collection.dateField]) {
              record[collection.dateField] = collection.timestamp ? new Date().toISOString() : today();
            }
            list.push(record);
            saveDb();
            return sendJson(201, record);
          });
        }
        return sendJson(405, { error: `Method ${req.method} not allowed` });
      }

      const index = list.findIndex(item => item.id === itemId);
      if (req.method === 'GET') {
        return index === -1 ? sendJson(404, { error: `No record with id ${itemId}` }) : sendJson(200, list[index]);
      }
      if (req.method === 'PUT') {
        if (index === -1) return sendJson(404, { error: `No record with id ${itemId}` });
        return readBody(payload => {
          if (!isPlainObject(payload)) return sendJson(400, { error: 'Payload must be a JSON object' });
          const record = { ...list[index], ...payload, id: itemId };
          list[index] = record;
          saveDb();
          return sendJson(200, record);
        });
      }
      if (req.method === 'DELETE') {
        if (index === -1) return sendJson(404, { error: `No record with id ${itemId}` });
        const [removed] = list.splice(index, 1);
        saveDb();
        return sendJson(200, removed);
      }
      return sendJson(405, { error: `Method ${req.method} not allowed` });
    }

    return sendJson(404, { error: 'Not Found', path: pathname });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(405, { error: `Method ${req.method} not allowed` });
  }

  const filePath = resolveStaticPath(pathname);
  if (filePath === null) {
    return sendJson(400, { error: 'Invalid path' });
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(req, res, filePath);
  }

  // SPA fallback for client-side routes (only for extension-less paths).
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (!path.extname(pathname) && fs.existsSync(indexPath)) {
    return serveFile(req, res, indexPath);
  }

  sendJson(404, { error: 'Not Found', path: pathname });
});

server.listen(PORT, HOST, () => {
  console.log(`[Backend Server] FIBER-GIS REST API running on http://localhost:${PORT}`);
  console.log(`[Backend Server] Health endpoint: http://localhost:${PORT}/api/health`);
});
