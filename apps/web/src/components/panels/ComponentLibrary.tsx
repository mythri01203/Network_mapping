import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import type { EquipmentType, CableType } from '@fibergis/shared';
import { Box, Search, ChevronLeft, ChevronRight, GripVertical, Plus, BookOpen } from 'lucide-react';
import { OltChassisIcon } from '../common/OltChassisIcon';
import { UtilityPoleIcon } from '../common/UtilityPoleIcon';

interface ComponentItem {
  type: EquipmentType;
  category: 'Central Office' | 'Fiber Distribution' | 'Supporting Infrastructure' | 'Customer Equipment' | 'Cable TV';
  name: string;
  description: string;
  defaultPorts?: number;
  iconBg: string;
}

const COMPONENTS: ComponentItem[] = [
  // Central Office
  {
    type: 'OLT',
    category: 'Central Office',
    name: 'Optical Line Terminal (OLT)',
    description: 'Main GPON/XGS-PON central chassis',
    defaultPorts: 16,
    iconBg: 'bg-blue-600',
  },
  {
    type: 'ODF',
    category: 'Central Office',
    name: 'Optical Distribution Frame',
    description: 'Central high-density patch bay',
    defaultPorts: 144,
    iconBg: 'bg-indigo-600',
  },
  {
    type: 'Core Switch',
    category: 'Central Office',
    name: '100G Core Switch',
    description: 'Metro IP backhaul aggregation',
    defaultPorts: 48,
    iconBg: 'bg-slate-700',
  },
  {
    type: 'Router',
    category: 'Central Office',
    name: 'BNG Core Router',
    description: 'Broadband Network Gateway',
    defaultPorts: 24,
    iconBg: 'bg-slate-800',
  },
  {
    type: 'Optical Transmitter',
    category: 'Central Office',
    name: '1550nm Transmitter',
    description: 'Cable TV optical laser headend',
    iconBg: 'bg-orange-600',
  },

  // Fiber Distribution
  {
    type: 'FDMS',
    category: 'Fiber Distribution',
    name: 'FDMS Street Cabinet',
    description: 'Primary fiber distribution cabinet',
    defaultPorts: 96,
    iconBg: 'bg-teal-600',
  },
  {
    type: 'FDT',
    category: 'Fiber Distribution',
    name: 'Fiber Distribution Terminal',
    description: 'Secondary feeder/branch termination',
    defaultPorts: 48,
    iconBg: 'bg-cyan-600',
  },
  {
    type: 'FAT',
    category: 'Fiber Distribution',
    name: 'Fiber Access Terminal (FAT)',
    description: 'Customer drop termination box',
    defaultPorts: 8,
    iconBg: 'bg-emerald-600',
  },
  {
    type: 'Pole-Mounted Terminal Box',
    category: 'Fiber Distribution',
    name: 'Pole-Mounted FAT',
    description: 'Weatherproof aerial drop enclosure',
    defaultPorts: 8,
    iconBg: 'bg-emerald-700',
  },
  {
    type: 'Wall-Mounted Terminal Box',
    category: 'Fiber Distribution',
    name: 'Building Wall Box',
    description: 'Basement/riser distribution box',
    defaultPorts: 16,
    iconBg: 'bg-emerald-800',
  },
  {
    type: 'Fiber Splitter',
    category: 'Fiber Distribution',
    name: 'PLC Splitter (1:8 / 1:16)',
    description: 'Passive optical beam splitter',
    defaultPorts: 8,
    iconBg: 'bg-purple-600',
  },
  {
    type: 'Fiber Joint Closure',
    category: 'Fiber Distribution',
    name: 'Joint Closure (Dome)',
    description: 'Underground/aerial splice enclosure',
    iconBg: 'bg-amber-600',
  },

  // Supporting Infrastructure
  {
    type: 'Telecom Pole',
    category: 'Supporting Infrastructure',
    name: 'Telecom Utility Pole',
    description: 'Aerial cable suspension pole',
    iconBg: 'bg-slate-600',
  },
  {
    type: 'Electric Pole',
    category: 'Supporting Infrastructure',
    name: 'Shared Electric Pole',
    description: 'Shared aerial distribution pole',
    iconBg: 'bg-slate-500',
  },
  {
    type: 'Manhole',
    category: 'Supporting Infrastructure',
    name: 'Underground Manhole',
    description: 'Subsurface duct entry chamber',
    iconBg: 'bg-stone-700',
  },
  {
    type: 'Handhole',
    category: 'Supporting Infrastructure',
    name: 'Sidewalk Handhole',
    description: 'Pavement access pull box',
    iconBg: 'bg-stone-600',
  },
  {
    type: 'Duct',
    category: 'Supporting Infrastructure',
    name: 'Telecom Duct Bank',
    description: 'Multi-way conduit infrastructure',
    iconBg: 'bg-zinc-700',
  },

  // Customer Equipment
  {
    type: 'ONT',
    category: 'Customer Equipment',
    name: 'Optical Network Terminal',
    description: 'Subscriber gigabit fiber modem',
    iconBg: 'bg-blue-500',
  },
  {
    type: 'Wi-Fi Router',
    category: 'Customer Equipment',
    name: 'Dual-Band Wi-Fi 6 Router',
    description: 'Customer premises wireless router',
    iconBg: 'bg-sky-600',
  },
  {
    type: 'Set-Top Box',
    category: 'Customer Equipment',
    name: 'IPTV / DVB-C Set-Top Box',
    description: 'Digital television receiver',
    iconBg: 'bg-amber-500',
  },

  // Cable TV
  {
    type: 'CATV Optical Node',
    category: 'Cable TV',
    name: 'CATV Optical Node',
    description: 'Fiber-to-Coaxial RF converter',
    iconBg: 'bg-orange-500',
  },
  {
    type: 'CATV RF Amplifier',
    category: 'Cable TV',
    name: 'RF Trunk / Line Extender',
    description: 'Coaxial signal RF booster amp',
    iconBg: 'bg-orange-600',
  },
  {
    type: 'CATV Tap-Off Box',
    category: 'Cable TV',
    name: '4-Way Tap-Off Box',
    description: 'Subscriber coaxial drop coupler',
    iconBg: 'bg-amber-600',
  },
];

const SIMPLE_COMPONENTS: Array<{
  type: EquipmentType;
  name: string;
  description: string;
  emoji: string;
  iconBg: string;
}> = [
  {
    type: 'OLT',
    name: 'Central Internet Hub (OLT)',
    description: 'Main building where internet originates',
    emoji: '🏢',
    iconBg: 'bg-blue-600',
  },
  {
    type: 'FAT',
    name: 'Street Customer Box (FAT)',
    description: 'Box on pole/wall where home wires plug in',
    emoji: '📦',
    iconBg: 'bg-emerald-600',
  },
  {
    type: 'FDT',
    name: 'Area Distribution Box (FDT)',
    description: 'Branch box sending cables down streets',
    emoji: '📦',
    iconBg: 'bg-cyan-600',
  },
  {
    type: 'Fiber Joint Closure',
    name: 'Cable Joint Box (Splice)',
    description: 'Enclosure joining multiple fiber wires',
    emoji: '🧰',
    iconBg: 'bg-amber-600',
  },
  {
    type: 'Telecom Pole',
    name: 'Utility Pole',
    description: 'Carries overhead fiber wires along roads',
    emoji: '⚡',
    iconBg: 'bg-slate-600',
  },
  {
    type: 'Manhole',
    name: 'Underground Manhole',
    description: 'Road chamber for underground cables',
    emoji: '🕳️',
    iconBg: 'bg-stone-700',
  },
  {
    type: 'ONT',
    name: 'Customer Home Modem (ONT)',
    description: 'Subscriber house connected to internet',
    emoji: '🏠',
    iconBg: 'bg-blue-500',
  },
  {
    type: 'Fiber Splitter',
    name: 'Signal Splitter',
    description: 'Splits 1 fiber line to 8 or 16 homes',
    emoji: '🔀',
    iconBg: 'bg-purple-600',
  },
];

export const ComponentLibrary: React.FC = () => {
  const {
    isLeftPanelOpen,
    setIsLeftPanelOpen,
    setActiveTool,
    setSelectedEquipmentTypeToAdd,
    selectedEquipmentTypeToAdd,
    setSelectedCableTypeToDraw,
    setIsCableWizardOpen,
    setIsComponentCatalogOpen,
    setIsKnowledgeModalOpen,
    showToast,
    uiMode,
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<string>('All');
  const [filterQuery, setFilterQuery] = useState('');

  const categories = [
    'All',
    'Central Office',
    'Fiber Distribution',
    'Supporting Infrastructure',
    'Customer Equipment',
    'Cable TV',
  ];

  const filteredComponents = COMPONENTS.filter((item) => {
    const matchesTab = activeTab === 'All' || item.category === activeTab;
    const matchesSearch =
      item.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(filterQuery.toLowerCase()) ||
      item.type.toLowerCase().includes(filterQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const handleDragStart = (e: React.DragEvent, type: EquipmentType) => {
    e.dataTransfer.setData('application/fiber-equipment-type', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleClickToPlace = (type: EquipmentType) => {
    setSelectedEquipmentTypeToAdd(type);
    setActiveTool('add_equipment');
    showToast('info', 'Click Map to Place', `Click anywhere on the GIS map to place ${type}.`);
  };

  const handleStartDrawCable = (cableType: CableType) => {
    setSelectedCableTypeToDraw(cableType);
    setActiveTool('draw_cable');
    showToast('info', 'Draw Cable Route', `Click points on the map to draw ${cableType}.`);
  };

  if (!isLeftPanelOpen) {
    return (
      <div className="w-9 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-3 gap-2 z-20">
        <button
          onClick={() => setIsLeftPanelOpen(true)}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
          title="Open Component Library"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-white/95 backdrop-blur-md border-r border-slate-200/80 flex flex-col z-20 shrink-0 select-none shadow-md transition-all duration-200">
      {/* Header */}
      <div className="p-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {uiMode === 'simple' ? <span className="text-base">📦</span> : <Box className="w-4 h-4 text-blue-600" />}
          <span className="font-bold text-xs text-slate-800">
            {uiMode === 'simple' ? 'Add Boxes & Cables' : 'Component Library'}
          </span>
        </div>
        <button
          onClick={() => setIsLeftPanelOpen(false)}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          title="Collapse Panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Equipment Knowledge Discovery Button */}
      <div className="p-2 border-b border-slate-100 bg-indigo-50/40">
        <button
          onClick={() => setIsKnowledgeModalOpen(true)}
          className="w-full py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
          title="Search what any network equipment is, how it works, and FTTH connection rules"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>📖 Learn Equipment (Google Search)</span>
        </button>
      </div>

      {uiMode === 'simple' ? (
        /* --- SIMPLE MODE VIEW FOR FIELD WORKERS --- */
        <>
          {/* Easy Instructions Banner */}
          <div className="p-2.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 font-semibold flex items-center gap-2">
            <span>👉 Click any item below, then click on the map to place it!</span>
          </div>

          {/* Quick Draw Cable Section */}
          <div className="p-3 border-b border-slate-100 bg-slate-50/70 space-y-1.5">
            <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Draw Fiber Wire</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleStartDrawCable('Main Feeder Fiber')}
                className="px-2 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl text-[11px] font-bold border border-blue-200 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-blue-600 shrink-0"></span>
                <span className="truncate">Main Road Line</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Distribution Fiber')}
                className="px-2 py-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-800 rounded-xl text-[11px] font-bold border border-cyan-200 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-cyan-600 shrink-0"></span>
                <span className="truncate">Street Line</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Drop Fiber')}
                className="px-2 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-[11px] font-bold border border-amber-200 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-amber-500 shrink-0"></span>
                <span className="truncate">House Wire</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Coaxial Cable')}
                className="px-2 py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-[11px] font-bold border border-orange-200 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-orange-600 shrink-0"></span>
                <span className="truncate">TV Coaxial</span>
              </button>
            </div>
          </div>

          {/* Search Button */}
          <div className="p-2.5 border-b border-slate-100">
            <button
              onClick={() => setIsComponentCatalogOpen(true)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Search className="w-3.5 h-3.5" /> Search All Types of Boxes
            </button>
          </div>

          {/* Simple Equipment List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Popular Boxes & Poles
            </div>
            {SIMPLE_COMPONENTS.map((item, idx) => {
              const isSelected = selectedEquipmentTypeToAdd === item.type;
              return (
                <div
                  key={`${item.type}-${idx}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.type)}
                  onClick={() => handleClickToPlace(item.type)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected ? 'bg-blue-50 border-blue-400 shadow-sm' : 'bg-white hover:bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.type === 'OLT' ? (
                      <OltChassisIcon width={38} height={20} className="shrink-0" />
                    ) : item.type.includes('Pole') ? (
                      <UtilityPoleIcon width={22} height={28} className="shrink-0" />
                    ) : (
                      <span className="text-xl shrink-0">{item.emoji}</span>
                    )}
                    <div>
                      <div className="font-bold text-xs text-slate-900">{item.name}</div>
                      <div className="text-[10px] text-slate-500 leading-tight mt-0.5 line-clamp-1">
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <Plus className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* --- PRO MODE VIEW FOR NETWORK ENGINEERS --- */
        <>
          {/* Search Input */}
          <div className="p-2.5 border-b border-slate-100">
            <button
              onClick={() => setIsComponentCatalogOpen(true)}
              className="w-full mb-2 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" /> Search Components
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter this list..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1 overflow-x-auto py-2 no-scrollbar">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveTab(cat)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors ${
                    activeTab === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat === 'Supporting Infrastructure' ? 'Infrastructure' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Cable Drawing Shortcuts */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/50">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span>Quick Draw Cable</span>
              <button
                onClick={() => setIsCableWizardOpen(true)}
                className="text-blue-600 hover:underline font-semibold text-[10px]"
              >
                Wizard &rarr;
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleStartDrawCable('Main Feeder Fiber')}
                className="px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-medium border border-blue-200/80 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></span>
                <span className="truncate">Feeder (96F)</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Distribution Fiber')}
                className="px-2 py-1.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg text-[11px] font-medium border border-cyan-200/80 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-600 shrink-0"></span>
                <span className="truncate">Distribution (24F)</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Drop Fiber')}
                className="px-2 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[11px] font-medium border border-amber-200/80 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                <span className="truncate">Drop Cable</span>
              </button>
              <button
                onClick={() => handleStartDrawCable('Coaxial Cable')}
                className="px-2 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg text-[11px] font-medium border border-orange-200/80 flex items-center gap-1.5 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-orange-600 shrink-0"></span>
                <span className="truncate">Coaxial Line</span>
              </button>
            </div>
          </div>

          {/* Equipment Component Items List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Drag to Map or Click to Place
            </div>

            {filteredComponents.map((item, idx) => {
              const isSelectedForPlacement = selectedEquipmentTypeToAdd === item.type;
              return (
                <div
                  key={`${item.type}-${idx}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.type)}
                  onClick={() => handleClickToPlace(item.type)}
                  className={`group p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelectedForPlacement
                      ? 'bg-blue-50 border-blue-400 shadow-sm'
                      : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.type === 'OLT' ? (
                      <OltChassisIcon width={36} height={19} className="shrink-0" />
                    ) : item.type.includes('Pole') ? (
                      <UtilityPoleIcon width={22} height={28} className="shrink-0" />
                    ) : (
                      <div
                        className={`w-8 h-8 rounded-lg ${item.iconBg} text-white flex items-center justify-center font-bold text-[10px] shrink-0 shadow-xs`}
                      >
                        {item.type.slice(0, 3)}
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-xs text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 leading-normal line-clamp-1">{item.description}</div>
                    </div>
                  </div>

                  <div className="text-slate-300 group-hover:text-slate-600 p-1">
                    <GripVertical className="w-3.5 h-3.5 cursor-grab" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
