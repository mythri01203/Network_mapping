import { CatalogComponent } from '../types/network';

export const BUILT_IN_COMPONENTS: CatalogComponent[] = [
  // Central Office Equipment
  { id: 'olt', type: 'OLT', category: 'Central Office', name: 'Optical Line Terminal (OLT)', description: 'Chassis OLT supporting GPON, EPON, and XGS-PON blades', defaultPorts: 16, iconBg: 'bg-blue-600' },
  { id: 'gpon-olt', type: 'OLT', category: 'Central Office', name: 'GPON OLT (ITU-T G.984)', description: 'Gigabit PON OLT (2.488 Gbps Down / 1.244 Gbps Up, up to 1:128 split)', defaultPorts: 16, iconBg: 'bg-blue-700' },
  { id: 'epon-olt', type: 'OLT', category: 'Central Office', name: 'EPON OLT (IEEE 802.3ah)', description: 'Ethernet PON OLT (1.25 Gbps Symmetric, up to 1:64 split)', defaultPorts: 8, iconBg: 'bg-indigo-700' },
  { id: 'odf', type: 'ODF', category: 'Central Office', name: 'Optical Distribution Frame (ODF)', description: 'High-density fiber patch and termination frame', defaultPorts: 144, iconBg: 'bg-indigo-600' },
  { id: 'core-switch', type: 'Core Switch', category: 'Central Office', name: 'Core Switch', description: 'Metro aggregation 10G/40G/100G Ethernet switch', defaultPorts: 48, iconBg: 'bg-slate-700' },
  { id: 'bng', type: 'Router', category: 'Central Office', name: 'Broadband Network Gateway', description: 'Subscriber session, PPPoE/IPoE and policy gateway', defaultPorts: 24, iconBg: 'bg-slate-800' },
  { id: 'headend', type: 'Cable TV Headend', category: 'Central Office', name: 'Cable TV Headend', description: 'CATV satellite receiver, encoding and RF combiner headend', iconBg: 'bg-orange-700' },
  { id: 'opt-tx', type: 'Optical Transmitter', category: 'Central Office', name: 'Optical Transmitter (1550nm)', description: '1550 nm externally modulated CATV optical laser transmitter', iconBg: 'bg-orange-600' },

  // Fiber Distribution Equipment
  { id: 'fdms', type: 'FDMS', category: 'Fiber Distribution', name: 'FDMS (Fiber Dist. Mgmt System)', description: 'Primary street fiber distribution and splicing hub cabinet', defaultPorts: 96, iconBg: 'bg-teal-600' },
  { id: 'fdt', type: 'FDT', category: 'Fiber Distribution', name: 'Fiber Distribution Terminal (FDT)', description: 'Secondary street termination and feeder breakout box', defaultPorts: 48, iconBg: 'bg-cyan-600' },
  { id: 'fat', type: 'FAT', category: 'Fiber Distribution', name: 'FAT Terminal Box', description: 'Fiber access terminal for customer drop wire connections', defaultPorts: 8, iconBg: 'bg-emerald-600' },
  { id: 'fat-access', type: 'Fiber Terminal Box', category: 'Fiber Distribution', name: 'Pole-Mounted Terminal Box', description: 'Rugged outdoor pole/wall fiber access terminal', defaultPorts: 16, iconBg: 'bg-emerald-700' },
  { id: 'splitter', type: 'Fiber Splitter', category: 'Fiber Distribution', name: 'PLC Fiber Splitter (1:8 / 1:16)', description: 'Planar Lightwave Circuit passive optical power divider', defaultPorts: 8, iconBg: 'bg-purple-600' },
  { id: 'joint', type: 'Fiber Joint Closure', category: 'Fiber Distribution', name: 'Dome Joint Closure', description: 'Weatherproof dome fusion splice closure for outdoor aerial/duct', iconBg: 'bg-amber-600' },
  { id: 'splice-cl', type: 'Splice Closure', category: 'Fiber Distribution', name: 'Horizontal In-line Splice Closure', description: 'In-line fusion splice closure for chamber or aerial messenger wire', iconBg: 'bg-amber-700' },
  { id: 'dist-cab', type: 'Fiber Distribution Cabinet', category: 'Fiber Distribution', name: 'Cross-Connect Cabinet (FDC)', description: 'High-capacity outdoor street cross-connect cabinet', defaultPorts: 144, iconBg: 'bg-teal-700' },

  // Outdoor Supporting Infrastructure
  { id: 'telecom-pole', type: 'Telecom Pole', category: 'Supporting Infrastructure', name: 'Telecom Pole (T-Crossarm)', description: 'Aerial cable suspension pole with crossarm and insulators', iconBg: 'bg-amber-800' },
  { id: 'electric-pole', type: 'Electric Pole', category: 'Supporting Infrastructure', name: 'Shared Utility Pole', description: 'Joint-use electrical and fiber aerial cable pole', iconBg: 'bg-slate-500' },
  { id: 'manhole', type: 'Manhole', category: 'Supporting Infrastructure', name: 'Telecom Manhole (MH)', description: 'Heavy-duty subsurface roadway chamber for main feeder duct access', iconBg: 'bg-stone-700' },
  { id: 'chamber', type: 'Underground Chamber', category: 'Supporting Infrastructure', name: 'Underground Vault / Chamber', description: 'Large underground access vault for cable pulling and splice loops', iconBg: 'bg-stone-800' },
  { id: 'duct', type: 'Duct', category: 'Supporting Infrastructure', name: 'Multi-Way Fiber Duct Conduit', description: 'HDPE multi-way telecom conduit pipeline infrastructure', iconBg: 'bg-zinc-700' },
  { id: 'handhole', type: 'Handhole', category: 'Supporting Infrastructure', name: 'Sidewalk Handhole (HH)', description: 'Pedestrian pavement pull-box for distribution cable access', iconBg: 'bg-stone-600' },
  { id: 'route', type: 'Junction Point', category: 'Supporting Infrastructure', name: 'Route Waypoint / Turning Joint', description: 'Route bend, anchor point, or underground conduit turn', iconBg: 'bg-blue-500' },
  { id: 'bldg-entry', type: 'Building Entry Point', category: 'Supporting Infrastructure', name: 'Building Entry Point (BEP)', description: 'External building facade conduit entry point for riser cables', iconBg: 'bg-slate-600' },

  // Customer Premises Equipment
  { id: 'ont', type: 'ONT', category: 'Customer Equipment', name: 'Optical Network Terminal (ONT)', description: 'Subscriber terminal converting optical signal to Ethernet/Wi-Fi', iconBg: 'bg-blue-500' },
  { id: 'onu', type: 'ONU', category: 'Customer Equipment', name: 'Optical Network Unit (ONU)', description: 'Multi-dwelling MDU or commercial enterprise optical unit', iconBg: 'bg-sky-700' },
  { id: 'wifi', type: 'Wi-Fi Router', category: 'Customer Equipment', name: 'Dual-Band Wi-Fi 6 Router', description: 'Premises gigabit wireless router for subscriber devices', iconBg: 'bg-sky-600' },
  { id: 'drop', type: 'Customer Terminal', category: 'Customer Equipment', name: 'FTTH Drop Terminal (Rosette)', description: 'Customer wall outlet rosette connecting flat drop wire to ONT patch cord', defaultPorts: 2, iconBg: 'bg-amber-500' },
  { id: 'stb', type: 'Set-Top Box', category: 'Customer Equipment', name: 'CATV 4K Set-Top Box', description: 'Digital television receiver with HDMI and RF input', iconBg: 'bg-amber-600' },

  // Cable TV Equipment
  { id: 'catv-rx', type: 'CATV Optical Node', category: 'Cable TV Infrastructure', name: 'Optical Receiver / Micro-Node', description: 'Converts 1550nm optical RF signal into coaxial RF output for TVs', iconBg: 'bg-red-600' },
  { id: 'catv-amp', type: 'CATV RF Amplifier', category: 'Cable TV Infrastructure', name: 'Trunk RF Line Extender Amplifier', description: 'Amplifies coaxial RF signal along street distribution runs', iconBg: 'bg-red-700' },
  { id: 'catv-tap', type: 'CATV Tap-Off Box', category: 'Cable TV Infrastructure', name: 'Coaxial Multi-Tap Splitter', description: 'Directional coupler tap-off delivering signal to subscriber coaxial drops', defaultPorts: 8, iconBg: 'bg-rose-700' }
];

export const PORT_STATUS_STYLE: Record<string, { fill: string; label: string; text: string }> = {
  Used: { fill: 'bg-emerald-500', label: 'Used', text: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
  Occupied: { fill: 'bg-emerald-500', label: 'Used', text: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
  Available: { fill: 'bg-blue-500', label: 'Available', text: 'text-blue-800 bg-blue-50 border-blue-200' },
  Reserved: { fill: 'bg-amber-400', label: 'Reserved', text: 'text-amber-800 bg-amber-50 border-amber-200' },
  Damaged: { fill: 'bg-rose-500', label: 'Damaged', text: 'text-rose-800 bg-rose-50 border-rose-200' },
  Faulty: { fill: 'bg-rose-500', label: 'Damaged', text: 'text-rose-800 bg-rose-50 border-rose-200' },
  Unverified: { fill: 'bg-slate-400', label: 'Unverified', text: 'text-slate-700 bg-slate-100 border-slate-200' }
};
