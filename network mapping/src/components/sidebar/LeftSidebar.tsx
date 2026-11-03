import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  LayoutDashboard,
  Map,
  Cpu,
  GitBranch,
  Wifi,
  Tv,
  Wrench,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Layers,
  PlusCircle,
  Users,
  Cable as CableIcon,
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  FolderTree,
  Crosshair,
  GitFork,
  Server,
  Box,
  FolderArchive,
  Database
} from 'lucide-react';

interface SidebarSection {
  id: string;
  title: string;
  icon: React.ElementType;
  items: Array<{
    id: string;
    label: string;
    count?: number;
    action: () => void;
  }>;
}

export const LeftSidebar: React.FC = () => {
  const {
    equipments,
    cables,
    customers,
    faults,
    workOrders,
    zones,
    documents,
    activeMainView,
    setActiveMainView,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    setIsCapacityDashboardOpen,
    setIsCableWizardOpen,
    setIsCustomerWizardOpen,
    setIsEquipmentModalOpen,
    setIsTerminalBoxModalOpen,
    setIsSplitterModalOpen,
    setIsSplicingModalOpen,
    setIsRouteTraceModalOpen,
    setIsFaultModalOpen,
    setIsReportsModalOpen,
    setIsTechnicianMobileOpen,
    setIsDocumentModalOpen,
    flyToLocation,
    setSelectedObject,
    toggleLayer,
    uiMode,
    setIsBikerMode
  } = useNetwork();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    mapping: true,
    fiber: true,
    cables: false,
    internet: false,
    operations: true,
    admin: false
  });

  const toggleSection = (id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const simpleSections: SidebarSection[] = [
    {
      id: 'dashboard',
      title: 'Overview & Outages',
      icon: LayoutDashboard,
      items: [
        { id: 'health', label: 'Broken Lines & Outages', count: faults.filter(f => f.status !== 'Resolved').length, action: () => setIsFaultModalOpen(true) },
        { id: 'overview', label: 'Network Capacity Overview', action: () => setIsCapacityDashboardOpen(true) },
        { id: 'reports', label: 'Reports & Analytics', action: () => setIsReportsModalOpen(true) }
      ]
    },
    {
      id: 'mapping',
      title: 'Map & Wizards',
      icon: Map,
      items: [
        { id: 'gis_center', label: 'GIS Network Map', action: () => { setActiveMainView('map'); flyToLocation(12.9385, 77.6275, 16); } },
        { id: 'new_cable_wiz', label: 'Draw Fiber Cable Wizard', action: () => setIsCableWizardOpen(true) },
        { id: 'new_cust_wiz', label: 'Connect Customer Wizard', action: () => setIsCustomerWizardOpen(true) },
        { id: 'route_trace', label: 'Follow Wire (Hub to Home)', action: () => setIsRouteTraceModalOpen(true) }
      ]
    },
    {
      id: 'fiber',
      title: 'Street Boxes & Hubs',
      icon: Cpu,
      items: [
        { id: 'inventory', label: 'All Equipment Inventory', count: equipments.length, action: () => setActiveMainView('inventory') },
        { id: 'fats', label: 'Street Customer Boxes (FAT)', count: equipments.filter(e => e.type === 'FAT' || e.type.includes('Terminal Box')).length, action: () => setIsTerminalBoxModalOpen(true) },
        { id: 'olt_rack', label: 'Main Internet Station (OLT)', count: equipments.filter(e => e.type === 'OLT').length, action: () => setActiveMainView('olt_rack') },
        { id: 'closures', label: 'Cable Joint Boxes (Splices)', count: 6, action: () => setIsSplicingModalOpen(true) },
        { id: 'poles', label: 'Utility Poles & Manholes', count: equipments.filter(e => e.type.includes('Pole') || e.type.includes('Manhole')).length, action: () => { setActiveMainView('map'); toggleLayer('poles'); } }
      ]
    },
    {
      id: 'cables',
      title: 'Fiber Cable Lines',
      icon: GitBranch,
      items: [
        { id: 'feeder_cables', label: 'Main Feeder Cables (96 Wires)', count: cables.filter(c => c.type === 'Main Feeder Fiber').length, action: () => { setActiveMainView('map'); toggleLayer('feederCable'); } },
        { id: 'dist_cables', label: 'Street Cables (24 Wires)', count: cables.filter(c => c.type === 'Distribution Fiber').length, action: () => { setActiveMainView('map'); toggleLayer('distributionCable'); } },
        { id: 'drop_cables', label: 'House Connection Wires', count: 25, action: () => { setActiveMainView('map'); toggleLayer('dropCable'); } }
      ]
    },
    {
      id: 'internet',
      title: 'Connected Customers',
      icon: Wifi,
      items: [
        { id: 'all_customers', label: 'Customer Directory', count: customers.length, action: () => setActiveMainView('customers') },
        { id: 'onboard_cust', label: 'Connect New Customer Home', action: () => setIsCustomerWizardOpen(true) }
      ]
    },
    {
      id: 'operations',
      title: 'Field Tech & Outages',
      icon: Wrench,
      items: [
        { id: 'biker_gps', label: 'Motorcycle Road GPS Navigation', action: () => { setActiveMainView('map'); setIsBikerMode(true); } },
        { id: 'active_faults', label: 'Active Outages & Cable Cuts', count: faults.filter(f => f.status !== 'Resolved').length, action: () => setIsFaultModalOpen(true) },
        { id: 'mobile_technician', label: 'Technician Mobile Portal', action: () => setIsTechnicianMobileOpen(true) }
      ]
    }
  ];

  const sections: SidebarSection[] = [
    {
      id: 'dashboard',
      title: 'Dashboard',
      icon: LayoutDashboard,
      items: [
        { id: 'overview', label: 'Network Capacity Overview', action: () => setIsCapacityDashboardOpen(true) },
        { id: 'health', label: 'Network Health & Outages', count: faults.filter(f => f.status !== 'Resolved').length, action: () => setIsFaultModalOpen(true) },
        { id: 'reports', label: 'Reports & Analytics', action: () => setIsReportsModalOpen(true) }
      ]
    },
    {
      id: 'mapping',
      title: 'Network Mapping',
      icon: Map,
      items: [
        { id: 'gis_center', label: 'GIS Network Map', action: () => { setActiveMainView('map'); flyToLocation(12.9385, 77.6275, 16); } },
        { id: 'topology_view', label: 'Network Topology View', action: () => setActiveMainView('topology') },
        { id: 'zone_mapping', label: 'Area & Zone Mapping', count: zones.length, action: () => setActiveMainView('zones') },
        { id: 'new_cable_wiz', label: 'Draw Fiber Cable Wizard', action: () => setIsCableWizardOpen(true) },
        { id: 'new_cust_wiz', label: 'Connect Customer Wizard', action: () => setIsCustomerWizardOpen(true) },
        { id: 'route_trace', label: 'Trace Fiber Route (OLT &rarr; ONT)', action: () => setIsRouteTraceModalOpen(true) }
      ]
    },
    {
      id: 'fiber',
      title: 'Fiber Infrastructure',
      icon: Cpu,
      items: [
        { id: 'olt_rack', label: 'OLT Central Office Chassis', count: equipments.filter(e => e.type === 'OLT').length, action: () => setActiveMainView('olt_rack') },
        { id: 'inventory', label: 'All Equipment Inventory', count: equipments.length, action: () => setActiveMainView('inventory') },
        { id: 'fats', label: 'FAT Terminal Boxes', count: equipments.filter(e => e.type === 'FAT' || e.type.includes('Terminal Box')).length, action: () => setIsTerminalBoxModalOpen(true) },
        { id: 'splitters', label: 'Fiber Splitters (PLC 1:2-1:64)', count: 10, action: () => setIsSplitterModalOpen(true) },
        { id: 'closures', label: 'Joint Closures & Splices', count: 6, action: () => setIsSplicingModalOpen(true) },
        { id: 'poles', label: 'Poles (Telecom & Electric)', count: equipments.filter(e => e.type.includes('Pole')).length, action: () => { setActiveMainView('map'); toggleLayer('poles'); } },
        { id: 'manholes', label: 'Manholes & Chambers', count: equipments.filter(e => e.type.includes('Manhole')).length, action: () => { setActiveMainView('map'); toggleLayer('manholes'); } }
      ]
    },
    {
      id: 'cables',
      title: 'Fiber Cable Management',
      icon: GitBranch,
      items: [
        { id: 'feeder_cables', label: 'Feeder Cables (96F/48F)', count: cables.filter(c => c.type === 'Main Feeder Fiber').length, action: () => { setActiveMainView('map'); toggleLayer('feederCable'); } },
        { id: 'dist_cables', label: 'Distribution Cables (24F)', count: cables.filter(c => c.type === 'Distribution Fiber').length, action: () => { setActiveMainView('map'); toggleLayer('distributionCable'); } },
        { id: 'drop_cables', label: 'Drop FTTH Cables (1F/2F)', count: 25, action: () => { setActiveMainView('map'); toggleLayer('dropCable'); } },
        { id: 'splice_matrix', label: 'Fusion Splicing Matrix', action: () => setIsSplicingModalOpen(true) }
      ]
    },
    {
      id: 'internet',
      title: 'Internet Management',
      icon: Wifi,
      items: [
        { id: 'all_customers', label: 'Customer Directory', count: customers.length, action: () => setActiveMainView('customers') },
        { id: 'active_onts', label: 'Active Subscriber ONTs', count: customers.filter(c => c.status === 'Active').length, action: () => setActiveMainView('customers') },
        { id: 'onboard_cust', label: 'New Customer Connection', action: () => setIsCustomerWizardOpen(true) }
      ]
    },
    {
      id: 'cabletv',
      title: 'Cable TV Management',
      icon: Tv,
      items: [
        { id: 'catv_system', label: 'HFC System Overview', action: () => setActiveMainView('cable_tv') },
        { id: 'catv_nodes', label: 'CATV Optical Nodes (1550nm)', count: 3, action: () => setActiveMainView('cable_tv') },
        { id: 'rf_amps', label: 'RF Amplifiers & Tap-Offs', count: 5, action: () => setActiveMainView('cable_tv') }
      ]
    },
    {
      id: 'operations',
      title: 'Operations & Faults',
      icon: Wrench,
      items: [
        { id: 'ops_hub', label: 'Operations Hub (Kanban)', count: workOrders.length, action: () => setActiveMainView('operations') },
        { id: 'active_faults', label: 'Network Outages & Fiber Cuts', count: faults.filter(f => f.status !== 'Resolved').length, action: () => setIsFaultModalOpen(true) },
        { id: 'mobile_technician', label: 'Field Technician Mobile Portal', action: () => setIsTechnicianMobileOpen(true) }
      ]
    },
    {
      id: 'admin',
      title: 'Administration',
      icon: ShieldCheck,
      items: [
        { id: 'admin_config', label: 'System Configuration & RBAC', action: () => setActiveMainView('admin') },
        { id: 'documents_repo', label: 'Technical Docs & Datasheets', count: documents.length, action: () => setIsDocumentModalOpen(true) },
        { id: 'audit_logs', label: 'System Audit Logs', action: () => setActiveMainView('admin') }
      ]
    }
  ];

  const currentSections = uiMode === 'simple' ? simpleSections : sections;

  if (isSidebarCollapsed) {
    return (
      <aside className="w-14 bg-white border-r border-slate-200/80 flex flex-col items-center py-3 gap-3 z-20 shrink-0 shadow-xs">
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          title="Expand Sidebar"
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {currentSections.map(sec => {
          const Icon = sec.icon;
          return (
            <button
              key={sec.id}
              onClick={() => { setIsSidebarCollapsed(false); setExpandedSections(prev => ({ ...prev, [sec.id]: true })); }}
              title={sec.title}
              className="p-2.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col z-20 shrink-0 select-none shadow-xs transition-all duration-200">
      {/* Sidebar Header */}
      <div className="h-10 px-4 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
        <span>{uiMode === 'simple' ? 'Quick Modules' : 'Navigation Modules'}</span>
        <button
          onClick={() => setIsSidebarCollapsed(true)}
          title="Collapse Sidebar"
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
        >
          <ChevronDown className="w-4 h-4 rotate-90" />
        </button>
      </div>

      {/* Accordion Sections */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {currentSections.map(sec => {
          const Icon = sec.icon;
          const isExpanded = expandedSections[sec.id];

          return (
            <div key={sec.id} className="rounded-xl overflow-hidden border border-transparent hover:border-slate-100 transition-colors">
              <button
                onClick={() => toggleSection(sec.id)}
                className={`w-full px-3 py-2 flex items-center justify-between rounded-lg text-xs font-semibold transition-all ${
                  isExpanded ? 'bg-slate-100/80 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isExpanded ? 'text-blue-600' : 'text-slate-500'}`} />
                  <span>{sec.title}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="py-1 pl-8 pr-2 space-y-0.5 animate-in fade-in slide-in-from-top-1">
                  {sec.items.map(item => (
                    <button
                      key={item.id}
                      onClick={item.action}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-600 hover:text-blue-700 hover:bg-blue-50/70 flex items-center justify-between transition-colors"
                    >
                      <span className="truncate">{item.label}</span>
                      {item.count !== undefined && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                          sec.id === 'operations' && item.count > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {item.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Launch Action Cards at Sidebar Bottom */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/60 flex flex-col gap-2">
        <button
          onClick={() => setIsCableWizardOpen(true)}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Draw New Cable</span>
        </button>

        <button
          onClick={() => setIsCustomerWizardOpen(true)}
          className="w-full py-2 px-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all"
        >
          <Users className="w-3.5 h-3.5 text-blue-600" />
          <span>Connect Customer</span>
        </button>
      </div>
    </aside>
  );
};
