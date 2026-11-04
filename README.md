# FiberGIS – Advanced Fiber Network Mapping and Management System
## Interactive Prototype for ISPs, Broadband Operators, and Cable TV Networks

FiberGIS is an enterprise-grade Geographical Information System (GIS) network mapping and infrastructure management application tailored for Internet Service Providers (ISPs), FTTH broadband operators, and Cable TV (HFC) network operators.

The application allows network administrators, planning engineers, NOC operators, and field technicians to visualize, document, and manage their complete optical and coaxial infrastructure through an intuitive GIS-based interface.

---

## 🌟 Key Functional Modules & Architecture

### 1. Main Application Layout & Responsive GIS Workspace
- **Top Navigation Bar:** Simple, self-explanatory navigation items: **Map**, **Network**, **Equipment**, **Customers**, **Cables**, **Cable TV**, **Field Work**, **Faults**, **Reports**, **Settings**. Includes global search, GIS layer controller, technical docs repository, outage count badge, and Biker Mode toggle.
- **Component Library Panel (Left):** Expandable/collapsible library with categories for Central Office (OLT, ODF, Switch, BNG, Optical Transmitter), Fiber Distribution (FDMS, FDT, FAT, Splitters, Closures), Infrastructure (Poles, Manholes, Chambers, Ducts), Customer Equipment (ONT, Wi-Fi 6 Router, Set-Top Box), and Cable TV. Includes a dedicated **Search Components** modal and click-to-place / drag-and-drop onto the map.
- **Central GIS Map Workspace:** Interactive Leaflet GIS map with smart cursor snapping, geodesic distance measurement, base map switcher (**GIS Light**, **Satellite Imagery**, **Night/Dark Mode**), custom SVG equipment markers, and dynamic map canvas resizing (`map.invalidateSize()`) whenever panels open or close.
- **Equipment Inspector Panel (Right):** Contextual inspector when selecting any equipment or cable, featuring OLT Optical Power Telemetry, Port Management shortcut, Biker Navigation, and connection actions.
- **Fiber Cores and Connection Table (Bottom):** Collapsible panel displaying selected cable core numbers, TIA-598 color swatches, operational statuses, connected endpoints, and attenuation in dB.

---

### 2. OLT Equipment Inspector & Optical Power Monitoring
- **OLT Details:** Name, ID, hardware manufacturer (Huawei SmartAX MA5800 / Nokia FX-4), management IP, rack/shelf/slot, uptime (4,280 hours), total & used PON ports, and connected customer count.
- **Optical Power Parameters:**
  - Transmit Power (Tx Power) in dBm (+3.2 dBm; normal threshold: 1.5 to 5.0 dBm).
  - Receive Power (Rx Power) in dBm (-18.6 dBm; warning threshold: -24 dBm, critical threshold: -27 dBm).
  - Optical Signal Status Level: Green (Normal), Yellow (Warning), Red (Critical), Grey (Unavailable).
  - Last updated timestamp.
- **Interactive PON Port Selector:** Switch between individual PON ports (PON-01 to PON-16) to view specific power readings and customer counts.
- **Historical Power Trend Mini Chart:** 12-hour SVG sparkline displaying Tx and Rx power drift over time alongside warning and critical threshold reference lines.
- **Disclaimer:** All telemetry is clearly labeled: `SIMULATED SAMPLE TELEMETRY · Not live equipment connection`.

---

### 3. TIA/EIA-598 Standard Fiber Color-Coding System
Standard 12-color sequence displayed with visual color badges and text labels for accessibility:
1. Blue (`#0066cc`)
2. Orange (`#ff6600`)
3. Green (`#009933`)
4. Brown (`#8b4513`)
5. Slate / Grey (`#708090`)
6. White (`#f0f0f0`)
7. Red (`#cc0000`)
8. Black (`#1a1a1a`)
9. Yellow (`#e6b800`)
10. Violet (`#7a0099`)
11. Rose (`#e6007e`)
12. Aqua (`#00bfff`)
- Extended multi-tube grouping for 24F, 48F, 96F, 144F, and 288F cables.
- Fiber color swatches are rendered in the core allocation table, splice manager, and route trace stepper.

---

### 4. Multiple Port Management (Used, Available, Reserved, Damaged, Unverified)
- Dedicated **Port Manager** modal with high-density visual grid (16, 48, or 96 ports).
- Color-coded status tiles:
  - **Green:** Used
  - **Blue:** Available
  - **Yellow:** Reserved
  - **Red:** Damaged
  - **Grey:** Unverified
- Real-time utilization percentage and port count breakdown.
- Detailed port inspector: port number, type (PON, FDMS, FDT, Terminal, Splitter), connected cable/core, connected equipment, assigned customer, and date.
- Status update actions (Assign, Release, Reserve, Damaged) with validation preventing accidental disconnection of active links.

---

### 5. Terminal Box Image & Interactive Port Annotator
- Dedicated FAT Terminal Box modal with multiple photo views:
  - Front View
  - Internal Splice Trays
  - Splitter Layout
  - Port Close-up
  - Pole / Wall Mount
  - Maintenance Inspection
- Non-destructive image annotation: click anywhere on the photograph to place numbered port badges with status indicators (Available, Occupied, Reserved, Faulty) without modifying the original image.
- Photo upload tool supporting local photo attachments.

---

### 6. Splicing & Joint Closure Management
- Dedicated fusion splicing matrix for underground dome closures and horizontal splice hubs.
- Incoming and outgoing cable selection with core numbers and TIA-598 color swatches.
- Endpoint validation: strictly prevents duplicate core endpoint assignments within the same closure, while allowing a continuous fiber core to participate in splices at different closures along its route.
- Splice status tracking: **Pending**, **Spliced**, **Tested**, and **Failed**.
- Insertion loss recording (e.g. 0.02 dB), splice tray selection (Tray 1-4), and certified splicer name.

---

### 7. End-to-End Fiber Route Tracing
- Complete connection tracing from Central Office to subscriber:
  `OLT → PON Port → Feeder Cable → Joint Closure → Distribution Cable → Splitter → FAT → Terminal Port → Drop Cable → ONT/ONU → Customer`
- Search by Customer ID, ONT Serial, Cable ID, OLT, Splitter, or FAT.
- Animated glowing halo highlights the active route on the Leaflet map.
- Telemetry summary: cumulative distance (meters), attenuation loss (dB), and optical power level.

---

### 8. Biker Mode – Motorcycle Navigation for Field Technicians
- Dedicated **Biker Mode** with motorcycle icon on Top Navigation, Floating Map Toolbar, Field Work view, and Equipment Inspector.
- Designed specifically for field technicians traveling between network sites:
  - High-contrast orange dashed road navigation line with dark casing on the GIS map.
  - Clear visual distinction between road navigation paths (orange dashed line) and fiber cables (solid colored lines).
  - Origin point with animated motorcycle marker and destination flag marker.
  - Multi-stop waypoints manager for scheduling technician travel.
  - Live distance in km (e.g. 1.25 km) and estimated travel time in minutes.
  - Turn-by-turn road navigation instructions.
  - Robust offline road generator fallback ensuring navigation always works smoothly.

---

### 9. Cable TV (CATV / HFC) Network Management
- Dedicated Cable TV module with interactive HFC distribution schematic:
  `Master Headend → 1550nm Optical Transmitter → EDFA Optical Amplifier → Fiber Trunk → CATV Optical Receiver Node → Coaxial Trunk (RG-11) → RF Line Extender Amplifiers → 4-Way Tap-Off Boxes → RG-6 Coaxial Drop → Subscriber Set-Top Boxes`
- Separate toggleable GIS map layer for coaxial cables and CATV nodes.
- RF spectrum frequency allocation view (Forward Path 54–862 MHz, Return Path 5–42 MHz, DOCSIS 3.1 channels).

---

### 10. Fault and Outage Incident Management
- Incident reporting for fiber cuts, cable damage, high attenuation, and equipment failure.
- GPS fault marker on the map with glowing red pulse animation.
- Automated downstream subscriber blast radius calculation (identifies all disconnected customers).
- Technician work order dispatch and resolution tracking.

---

### 11. Reports & Data Export
- **PDF Reports:** Clean executive summaries with equipment inventory and subscriber connectivity generated via `jsPDF`.
- **CSV / Excel:** Tabular dumps for equipment inventory, cable cores, customer connections, and fault logs.
- **GeoJSON Export:** Standard GIS FeatureCollection compatible with QGIS, ArcGIS, and PostGIS.

---

## 🧭 Complete User Journey Walkthrough

To experience the full prototype workflow:
1. **Add Equipment:** Open Component Library (or click **Search Components**), drag or click **FAT Terminal Box** onto the GIS map.
2. **Draw Cable:** Click **Draw Cable** on the floating toolbar, click points on the map with smart snapping to equipment, and complete the 6-step cable wizard.
3. **Assign Fiber Cores:** Click the cable, open the **Bottom Fiber Core Table**, and assign Core 1 (Blue) to a downstream terminal.
4. **Manage Ports:** Select the OLT or FAT, click **Manage Ports (Visual Grid)** in the inspector to view and update used/available ports.
5. **Configure Splitter:** Open **Fiber Splitters**, view 1:8 PLC schematic, input feeder signal, and output customer ports.
6. **Create Splices:** Open **Joint Closure Manager**, choose `JC-01`, select incoming Feeder cable Core 1 and outgoing Distribution cable Core 1, and click **Fuse Splice**.
7. **Connect Customer:** Click **Connect Customer Wizard** (or Customers view) to provision a new subscriber with FAT port and ONT serial.
8. **View OLT Power:** Click `OLT-01` on the map; inspect Tx (+3.2 dBm) and Rx (-18.6 dBm) power gauges, PON port selector, and the 12-hour trend chart.
9. **Trace Fiber Route:** Click **Trace Connections** on the customer or OLT to view the complete glowing end-to-end optical route on the map.
10. **Navigate with Biker Mode:** Click **Navigate to Asset (Biker Mode)** in the inspector or the motorcycle button in the top navigation to view the orange road navigation line, travel time, and turn-by-turn directions.

---

## 💻 Running the Application

Requirements: Node.js 22.13+ (Node 24 recommended, see `.nvmrc`).

```bash
npm install        # installs every workspace from the repo root
npm run dev        # starts the web app (Vite) at http://localhost:3000
npm run server     # starts the API server on port 5000
npm run build      # production build of every workspace
npm run typecheck  # type-checks every workspace
```

## Repository Layout

```
apps/
  web/        React + Vite + Leaflet single-page app (@fibergis/web)
packages/     shared libraries (added as the codebase is modularised)
```
