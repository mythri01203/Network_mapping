import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { UserRole, MainView } from '../../types/network';
import {
  Globe,
  Search,
  Layers,
  FileText,
  AlertTriangle,
  UserCheck,
  HelpCircle,
  Tv,
  ChevronDown,
  Check,
  MapPin,
  GitFork,
  Box,
  Users,
  Cable,
  Bike,
  BarChart3,
  Settings,
  Menu,
  FolderArchive,
  Sparkles,
  BookOpen
} from 'lucide-react';

export const TopNavBar: React.FC = () => {
  const {
    activeMainView,
    setActiveMainView,
    equipments,
    cables,
    customers,
    faults,
    userRole,
    setUserRole,
    networkMode,
    setNetworkMode,
    uiMode,
    setUiMode,
    activeLayers,
    toggleLayer,
    setIsCapacityDashboardOpen,
    setIsCustomerWizardOpen,
    setIsCableWizardOpen,
    setIsFaultModalOpen,
    setIsReportsModalOpen,
    setIsTechnicianMobileOpen,
    setIsBikerMode,
    setIsHelpModalOpen,
    setIsDocumentModalOpen,
    setIsLayersDrawerOpen,
    setIsKnowledgeModalOpen,
    flyToLocation,
    setSelectedObject
  } = useNetwork();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Search filter across equipment, cables, customers, and faults
  const searchResults = searchQuery.trim() === '' ? [] : [
    ...equipments.filter(e =>
      e.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.area.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(e => ({ type: 'equipment' as const, id: e.id, label: e.name, sub: `${e.type} &bull; ${e.area}`, data: e })),
    ...cables.filter(c =>
      c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(c => ({ type: 'cable' as const, id: c.id, label: c.name, sub: `${c.type} &bull; ${c.lengthMeters}m`, data: c })),
    ...customers.filter(cu =>
      cu.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cu.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cu.ontSerialNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cu.ipAddress.includes(searchQuery)
    ).map(cu => ({ type: 'customer' as const, id: cu.id, label: cu.name, sub: `ONT: ${cu.ontSerialNumber} &bull; ${cu.plan}`, data: cu })),
    ...faults.filter(f =>
      f.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.title.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(f => ({ type: 'fault' as const, id: f.id, label: f.title, sub: `${f.severity} &bull; ${f.status}`, data: f }))
  ].slice(0, 8);

  const handleSelectSearchResult = (result: any) => {
    setSelectedObject({ type: result.type, data: result.data });
    setActiveMainView('map');
    if (result.data.lat && result.data.lng) {
      setTimeout(() => flyToLocation(result.data.lat, result.data.lng, 18), 100);
    } else if (result.data.coordinates && result.data.coordinates.length > 0) {
      const mid = result.data.coordinates[Math.floor(result.data.coordinates.length / 2)];
      setTimeout(() => flyToLocation(mid[0], mid[1], 17), 100);
    }
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  const activeFaultsCount = faults.filter(f => f.status !== 'Resolved').length;

  const simpleNavItems = [
    { id: 'map' as MainView, label: 'Map', emoji: '🗺️', tooltip: 'View the complete fiber network on Google Maps style GIS' },
    { id: 'inventory' as MainView, label: 'Boxes & Cables', emoji: '📦', tooltip: 'View street distribution boxes, poles, cables, and hubs' },
    { id: 'inventory' as MainView, label: 'Learn Equipment', emoji: '📖', tooltip: 'Search & learn what any equipment is (OLT, FAT, FDMS, Splitter)', action: () => setIsKnowledgeModalOpen(true) },
    { id: 'customers' as MainView, label: 'Customers', emoji: '👥', tooltip: 'View connected houses and subscribers' },
    { id: 'map' as MainView, label: 'Bike GPS', emoji: '🏍️', tooltip: 'Turn-by-turn road navigation for field workers', action: () => { setActiveMainView('map'); setIsBikerMode(true); } },
    { id: 'operations' as MainView, label: 'Outages', emoji: '⚠️', tooltip: 'View broken lines and outages needing repair', action: () => { setActiveMainView('operations'); setIsFaultModalOpen(true); }, count: activeFaultsCount },
    { id: 'admin' as MainView, label: 'Reports', emoji: '📊', tooltip: 'View network health & capacity summary', action: () => setIsReportsModalOpen(true) }
  ];

  const mainNavItems: Array<{ id: MainView; label: string; icon: React.ElementType; tooltip: string; action?: () => void }> = [
    { id: 'map', label: 'Map', icon: MapPin, tooltip: 'View the complete fiber network on the GIS map' },
    { id: 'topology', label: 'Network', icon: GitFork, tooltip: 'View physical and logical connections' },
    { id: 'inventory', label: 'Equipment', icon: Box, tooltip: 'Manage network equipment inventory' },
    { id: 'customers', label: 'Customers', icon: Users, tooltip: 'Manage customer connections' },
    { id: 'cables', label: 'Cables', icon: Cable, tooltip: 'Draw and manage fiber cables' },
    { id: 'cable_tv', label: 'Cable TV', icon: Tv, tooltip: 'Manage coaxial and TV infrastructure' },
    { id: 'field', label: 'Field Work', icon: Bike, tooltip: 'Technician activities and biker navigation' },
    { id: 'operations', label: 'Faults', icon: AlertTriangle, tooltip: 'View and manage network faults', action: () => { setActiveMainView('operations'); setIsFaultModalOpen(true); } },
    { id: 'admin', label: 'Reports', icon: BarChart3, tooltip: 'Network reports and analytics', action: () => setIsReportsModalOpen(true) },
    { id: 'admin', label: 'Settings', icon: Settings, tooltip: 'Users, permissions, and system configuration' }
  ];

  return (
    <header className="h-14 bg-white border-b border-slate-200/80 px-3 sm:px-4 flex items-center justify-between z-30 shrink-0 select-none shadow-xs">
      {/* Brand Logo & Mode Toggle & Main Nav Tabs */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Brand */}
        <div
          onClick={() => setActiveMainView('map')}
          className="flex items-center gap-2 cursor-pointer group shrink-0 mr-1"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-700 to-sky-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm tracking-tight text-slate-900">
                FIBER<span className="text-blue-600">-GIS</span>
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase ${
                uiMode === 'simple'
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                {uiMode === 'simple' ? 'SIMPLE' : 'PRO'}
              </span>
            </div>
          </div>
        </div>

        {/* UI Mode Toggle (✨ Simple vs ⚙️ Pro) */}
        <button
          onClick={() => setUiMode(uiMode === 'simple' ? 'pro' : 'simple')}
          title="Toggle between Simple Everyday View and Pro Telecom Engineering Mode"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-2xs ${
            uiMode === 'simple'
              ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
          }`}
        >
          <Sparkles className={`w-3.5 h-3.5 ${uiMode === 'simple' ? 'text-amber-600' : 'text-slate-500'}`} />
          <span className="hidden sm:inline">{uiMode === 'simple' ? '✨ Simple Mode' : '⚙️ Pro Mode'}</span>
          <span className="sm:hidden">{uiMode === 'simple' ? 'Simple' : 'Pro'}</span>
        </button>

        {/* Main View Navigation Tabs */}
        {uiMode === 'simple' ? (
          <nav className="hidden lg:flex items-center bg-slate-100/90 p-0.5 rounded-xl border border-slate-200 text-xs font-semibold">
            {simpleNavItems.map(item => {
              const isActive =
                (item.label === 'Outages' && activeMainView === 'operations') ||
                (item.label === 'Reports' && activeMainView === 'admin') ||
                (activeMainView === item.id && item.label !== 'Reports' && item.label !== 'Outages');

              return (
                <button
                  key={item.label}
                  title={item.tooltip}
                  onClick={() => item.action ? item.action() : setActiveMainView(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <span className="text-sm">{item.emoji}</span>
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full ml-0.5">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        ) : (
          <nav className="hidden xl:flex items-center bg-slate-100/90 p-0.5 rounded-xl border border-slate-200 text-xs font-semibold">
            {mainNavItems.map(item => {
              const Icon = item.icon;
              const isActive =
                (item.label === 'Faults' && activeMainView === 'operations') ||
                (item.label === 'Reports' && activeMainView === 'admin') ||
                (item.label === 'Settings' && activeMainView === 'admin') ||
                (activeMainView === item.id && item.label !== 'Reports' && item.label !== 'Faults');

              return (
                <button
                  key={item.label}
                  title={item.tooltip}
                  onClick={() => item.action ? item.action() : setActiveMainView(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Medium Screen Compact Tabs with More dropdown for Pro Mode */}
        {uiMode === 'pro' && (
          <nav className="hidden lg:flex xl:hidden items-center bg-slate-100/90 p-0.5 rounded-xl border border-slate-200 text-xs font-semibold">
            {mainNavItems.slice(0, 5).map(item => {
              const Icon = item.icon;
              const isActive = activeMainView === item.id;

              return (
                <button
                  key={item.label}
                  title={item.tooltip}
                  onClick={() => item.action ? item.action() : setActiveMainView(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="relative">
              <button
                title="More Options"
                onClick={() => setIsMoreOpen(!isMoreOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-200/50"
              >
                More <ChevronDown className="w-3 h-3" />
              </button>
              {isMoreOpen && (
                <div className="absolute left-0 mt-1 w-44 bg-white border rounded-xl shadow-xl p-1 z-50" onMouseLeave={() => setIsMoreOpen(false)}>
                  {mainNavItems.slice(5).map(item => (
                    <button
                      key={item.label}
                      title={item.tooltip}
                      onClick={() => { item.action ? item.action() : setActiveMainView(item.id); setIsMoreOpen(false); }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-50 flex items-center gap-2"
                    >
                      <item.icon className="w-3.5 h-3.5 text-slate-500" /> {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        )}

        {/* Mobile / Small Screen Navigation Menu */}
        <div className="relative lg:hidden">
          <button className="p-1.5 border rounded-lg text-slate-700" title="Open navigation" onClick={() => setIsMoreOpen(!isMoreOpen)}>
            <Menu className="w-4 h-4" />
          </button>
          {isMoreOpen && (
            <div className="absolute left-0 mt-1 w-52 bg-white border rounded-xl shadow-xl p-1.5 z-50">
              {(uiMode === 'simple' ? simpleNavItems : mainNavItems).map((item: any) => (
                <button
                  key={item.label}
                  title={item.tooltip}
                  onClick={() => { item.action ? item.action() : setActiveMainView(item.id); setIsMoreOpen(false); }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-50 flex items-center gap-2 font-medium text-slate-700"
                >
                  {item.emoji ? <span className="text-sm">{item.emoji}</span> : <item.icon className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center Global Search Bar */}
      <div className="relative flex-1 max-w-xs sm:max-w-sm mx-2 sm:mx-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={uiMode === 'simple' ? "Search box, house, cable, or customer..." : "Search equipment, cable, customer, ONT or IP..."}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all placeholder:text-slate-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Search Results Dropdown */}
        {isSearchFocused && searchResults.length > 0 && (
          <div
            className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-50 animate-in fade-in slide-in-from-top-2"
            onMouseLeave={() => setIsSearchFocused(false)}
          >
            <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Search Results</div>
            {searchResults.map((res, i) => (
              <button
                key={`${res.id}-${i}`}
                onClick={() => handleSelectSearchResult(res)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs transition-colors"
              >
                <div>
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-blue-600">{res.id}</span>
                    <span>{res.label}</span>
                  </div>
                  <div className="text-[10px] text-slate-400" dangerouslySetInnerHTML={{ __html: res.sub }} />
                </div>
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Action Icons & Utilities */}
      <div className="flex items-center gap-1.5">
        {/* Pro Mode Only Tools */}
        {uiMode === 'pro' && (
          <>
            {/* Advanced GIS Layers Drawer Button */}
            <button
              onClick={() => setIsLayersDrawerOpen(true)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="Advanced GIS Layer Controls & Opacity"
            >
              <Layers className="w-4 h-4 text-blue-600" />
              <span className="hidden md:inline">Layers</span>
            </button>

            {/* Technical Documents Repository Button */}
            <button
              onClick={() => setIsDocumentModalOpen(true)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="Technical Documentation, OTDR Traces & Datasheets"
            >
              <FolderArchive className="w-4 h-4 text-purple-600" />
              <span className="hidden md:inline">Docs</span>
            </button>

            {/* Capacity Dashboard Shortcut */}
            <button
              onClick={() => setIsCapacityDashboardOpen(true)}
              className="p-1.5 text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Network Capacity Dashboard"
            >
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              <span className="hidden xl:inline">Dashboard</span>
            </button>

            {/* Reports Shortcut */}
            <button
              onClick={() => setIsReportsModalOpen(true)}
              className="p-1.5 text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Generate Reports & PDF Export"
            >
              <FileText className="w-4 h-4 text-emerald-600" />
              <span className="hidden xl:inline">Reports</span>
            </button>
          </>
        )}

        {/* Equipment Information & Google-Like Discovery Shortcut */}
        <button
          onClick={() => setIsKnowledgeModalOpen(true)}
          className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-lg border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
          title="Equipment Information & Discovery (Search what an OLT, FDMS, FAT, Splitter is)"
        >
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <span className="hidden md:inline">📖 Learn Equipment</span>
        </button>

        {/* Faults / Outages Shortcut with notification badge */}
        <button
          onClick={() => setIsFaultModalOpen(true)}
          className={`relative p-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
            activeFaultsCount > 0 ? 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
          title="Fault & Outage Management"
        >
          <AlertTriangle className={`w-4 h-4 ${activeFaultsCount > 0 ? 'text-rose-600 animate-pulse' : 'text-slate-500'}`} />
          <span className="hidden sm:inline">Outages</span>
          {activeFaultsCount > 0 && (
            <span className="bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {activeFaultsCount}
            </span>
          )}
        </button>

        {/* Biker Navigation Shortcut */}
        <button
          onClick={() => { setActiveMainView('map'); setIsBikerMode(true); }}
          className="p-1.5 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-lg border border-orange-200 text-xs font-semibold flex items-center gap-1.5"
          title="Biker Mode — motorcycle/road navigation between network sites"
        >
          <Bike className="w-4 h-4 text-orange-600" />
          <span className="hidden sm:inline">Bike GPS</span>
        </button>

        {/* Role Switcher */}
        <div className="relative">
          <button
            onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
            className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-slate-200/80 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden md:inline">{userRole}</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>

          {isRoleMenuOpen && (
            <div
              className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-50 animate-in fade-in"
              onMouseLeave={() => setIsRoleMenuOpen(false)}
            >
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase">Switch Active Role</div>
              {(['Administrator', 'Network Engineer', 'Network Operator', 'Field Technician', 'Supervisor'] as UserRole[]).map(role => (
                <button
                  key={role}
                  onClick={() => { setUserRole(role); setIsRoleMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                    userRole === role ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{role}</span>
                  {userRole === role && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Help button */}
        <button
          onClick={() => setIsHelpModalOpen(true)}
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          title="Help, User Guide & Documentation"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
