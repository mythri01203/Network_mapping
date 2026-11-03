import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'server_data.json');

// Initialize data store
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
    version: '2.0.0',
    mode: 'Combined FTTH & Cable TV HFC',
    status: 'Operational',
    startedAt: new Date().toISOString()
  }
};

// Load existing data if available
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    db = { ...db, ...JSON.parse(raw) };
    console.log('[API] Loaded persistent database from server_data.json');
  } catch (err) {
    console.warn('[API] Could not parse server_data.json, starting with fresh store');
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('[API] Failed to persist data:', err.message);
  }
}

// Request router
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Helper to send JSON
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper to read JSON body
  const readBody = (callback) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        callback(data);
      } catch (e) {
        sendJson(400, { error: 'Invalid JSON payload' });
      }
    });
  };

  // 1. Health check
  if (pathname === '/api/health') {
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

  // 2. Summary Endpoint
  if (pathname === '/api/network/summary') {
    return sendJson(200, {
      systemInfo: db.systemInfo,
      kpis: {
        totalEquipment: db.equipment.length,
        totalCables: db.cables.length,
        totalCustomers: db.customers.length,
        activeFaults: db.faults.filter(f => f.status !== 'Resolved').length,
        activeWorkOrders: db.workOrders.filter(w => w.status !== 'Completed').length,
        totalZones: db.zones.length
      }
    });
  }

  // 3. Equipment endpoints
  if (pathname === '/api/equipment') {
    if (req.method === 'GET') {
      return sendJson(200, db.equipment);
    }
    if (req.method === 'POST') {
      return readBody(newEq => {
        const id = newEq.id || `EQ-${Date.now().toString().slice(-4)}`;
        const record = { ...newEq, id, installedDate: newEq.installedDate || new Date().toISOString().split('T')[0] };
        db.equipment.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 4. Cables endpoints
  if (pathname === '/api/cables') {
    if (req.method === 'GET') {
      return sendJson(200, db.cables);
    }
    if (req.method === 'POST') {
      return readBody(newCable => {
        const id = newCable.id || `CBL-${Date.now().toString().slice(-5)}`;
        const record = { ...newCable, id, installationDate: new Date().toISOString().split('T')[0] };
        db.cables.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 5. Customers endpoints
  if (pathname === '/api/customers') {
    if (req.method === 'GET') {
      return sendJson(200, db.customers);
    }
    if (req.method === 'POST') {
      return readBody(newCust => {
        const id = newCust.id || `CUST-0${db.customers.length + 1}`;
        const record = { ...newCust, id, installationDate: new Date().toISOString().split('T')[0] };
        db.customers.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 6. Faults endpoints
  if (pathname === '/api/faults') {
    if (req.method === 'GET') {
      return sendJson(200, db.faults);
    }
    if (req.method === 'POST') {
      return readBody(newFault => {
        const id = newFault.id || `FLT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
        const record = { ...newFault, id, reportedAt: new Date().toLocaleString() };
        db.faults.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 7. Work orders endpoints
  if (pathname === '/api/work-orders') {
    if (req.method === 'GET') {
      return sendJson(200, db.workOrders);
    }
    if (req.method === 'POST') {
      return readBody(newWo => {
        const id = newWo.id || `WO-${Date.now().toString().slice(-5)}`;
        const record = { ...newWo, id, scheduledDate: new Date().toISOString().split('T')[0] };
        db.workOrders.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 8. Zones endpoints
  if (pathname === '/api/zones') {
    if (req.method === 'GET') {
      return sendJson(200, db.zones);
    }
    if (req.method === 'POST') {
      return readBody(newZone => {
        const id = newZone.id || `ZONE-${Date.now().toString().slice(-4)}`;
        const record = { ...newZone, id };
        db.zones.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 9. Documents endpoints
  if (pathname === '/api/documents') {
    if (req.method === 'GET') {
      return sendJson(200, db.documents);
    }
    if (req.method === 'POST') {
      return readBody(newDoc => {
        const id = newDoc.id || `DOC-${Date.now().toString().slice(-4)}`;
        const record = { ...newDoc, id, uploadDate: new Date().toISOString().split('T')[0] };
        db.documents.push(record);
        saveDb();
        return sendJson(201, record);
      });
    }
  }

  // 10. Database Backup & Restore endpoints
  if (pathname === '/api/backup' && req.method === 'GET') {
    return sendJson(200, {
      exportTimestamp: new Date().toISOString(),
      ...db
    });
  }

  if (pathname === '/api/restore' && req.method === 'POST') {
    return readBody(importedData => {
      if (importedData.equipment) db.equipment = importedData.equipment;
      if (importedData.cables) db.cables = importedData.cables;
      if (importedData.customers) db.customers = importedData.customers;
      if (importedData.faults) db.faults = importedData.faults;
      if (importedData.workOrders) db.workOrders = importedData.workOrders;
      if (importedData.zones) db.zones = importedData.zones;
      if (importedData.documents) db.documents = importedData.documents;
      saveDb();
      return sendJson(200, { success: true, message: 'Database state restored successfully' });
    });
  }

  // 11. Static File Serving from dist/ for direct access
  const distPath = path.join(__dirname, 'dist');
  let filePath = path.join(distPath, pathname === '/' ? 'index.html' : pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallback to index.html for SPA client-side routing
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  // Not found
  sendJson(404, { error: 'Not Found', path: pathname });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Backend Server] FIBER-GIS REST API running on http://localhost:${PORT}`);
  console.log(`[Backend Server] Health endpoint: http://localhost:${PORT}/api/health`);
});
