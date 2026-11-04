import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useMapStore } from '../../stores/mapStore';
import { useOpenView } from '../../app/views';
import { EQUIPMENT_KNOWLEDGE_BASE, searchEquipmentKnowledge } from '../../data/equipmentKnowledgeBase';
import {
  Search,
  X,
  BookOpen,
  ArrowRight,
  Layers,
  Cpu,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  MapPin,
  ChevronRight,
  ShieldCheck,
  Server,
  Cable,
} from 'lucide-react';

interface EquipmentKnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEquipmentId?: string | null;
}

export const EquipmentKnowledgeModal: React.FC<EquipmentKnowledgeModalProps> = ({
  isOpen,
  onClose,
  initialEquipmentId,
}) => {
  const { setSelectedEquipmentTypeToAdd, setActiveTool, flyToLocation } = useMapStore(
    useShallow((s) => ({
      setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setActiveTool: s.setActiveTool,
      flyToLocation: s.flyTo,
    })),
  );
  const showToast = useToastStore((s) => s.show);
  const equipments = useNetworkStore((s) => s.equipment);
  const openView = useOpenView();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeItemSlug, setActiveItemSlug] = useState<string>(initialEquipmentId || 'olt');
  const [viewMode, setViewMode] = useState<'beginner' | 'engineer'>('beginner');

  // Sync initialEquipmentId if prop changes
  React.useEffect(() => {
    if (initialEquipmentId) {
      const match = EQUIPMENT_KNOWLEDGE_BASE.find(
        (item) => item.id === initialEquipmentId || item.id.toLowerCase() === initialEquipmentId.toLowerCase(),
      );
      if (match) {
        setActiveItemSlug(match.id);
      }
    }
  }, [initialEquipmentId]);

  // Suggested Google-style questions
  const popularQuestions = [
    { label: 'What is an FDMS?', query: 'What is an FDMS?' },
    { label: 'What is a GPON OLT?', query: 'What is a GPON OLT?' },
    { label: 'What is an EPON OLT?', query: 'What is an EPON OLT?' },
    { label: 'What is a FAT box?', query: 'What is a FAT box?' },
    { label: 'What is a 1:8 splitter?', query: 'What is a 1:8 splitter?' },
    { label: 'What is a joint closure?', query: 'What is a joint closure?' },
    { label: 'What is an optical receiver?', query: 'What is an optical receiver?' },
    { label: 'Difference between OLT and ONT', query: 'Difference between OLT and ONT' },
    { label: 'Difference between GPON and EPON', query: 'Difference between GPON and EPON' },
  ];

  // Filtered knowledge items
  const filteredItems = useMemo(() => {
    let list = searchEquipmentKnowledge(searchQuery);
    if (selectedCategory !== 'All') {
      list = list.filter((item) => item.category === selectedCategory);
    }
    return list;
  }, [searchQuery, selectedCategory]);

  // Active selected item
  const activeItem = useMemo(() => {
    return (
      EQUIPMENT_KNOWLEDGE_BASE.find((item) => item.id === activeItemSlug) ||
      filteredItems[0] ||
      EQUIPMENT_KNOWLEDGE_BASE[0]
    );
  }, [activeItemSlug, filteredItems]);

  if (!isOpen) return null;

  // FTTH Flow Steps
  const ftthFlow = [
    { step: 1, id: 'olt', name: '1. OLT' },
    { step: 2, id: 'odf', name: '2. ODF' },
    { step: 3, id: 'joint-closure', name: '3. Closure' },
    { step: 4, id: 'fdms', name: '4. FDMS' },
    { step: 5, id: 'telecom-pole', name: '5. Pole' },
    { step: 6, id: 'splitter', name: '6. Splitter' },
    { step: 7, id: 'fat', name: '7. FAT Box' },
    { step: 8, id: 'ont', name: '8. ONT (Home)' },
  ];

  // Handle Place on Map
  const handlePlaceOnMap = () => {
    onClose();
    openView('map');
    let targetType: any = 'FAT';
    if (activeItem.id.includes('olt')) targetType = 'OLT';
    else if (activeItem.id === 'odf') targetType = 'ODF';
    else if (activeItem.id === 'fdms') targetType = 'FDMS';
    else if (activeItem.id.includes('pole')) targetType = 'Telecom Pole';
    else if (activeItem.id.includes('splitter')) targetType = 'Fiber Splitter';
    else if (activeItem.id.includes('closure')) targetType = 'Fiber Joint Closure';
    else if (activeItem.id.includes('ont')) targetType = 'ONT';

    setSelectedEquipmentTypeToAdd(targetType);
    setActiveTool('add_equipment');
    showToast('info', `Placement Active`, `Click anywhere on the GIS map to drop a new ${targetType}.`);
  };

  // Find existing equipment on map
  const matchingPlacedEquipment = equipments.find((e) => {
    if (activeItem.id === 'olt' || activeItem.id === 'gpon-olt' || activeItem.id === 'epon-olt') {
      return e.type === 'OLT';
    }
    if (activeItem.id === 'odf') return e.type === 'ODF';
    if (activeItem.id === 'fdms') return e.type === 'FDMS';
    if (activeItem.id === 'fat') return e.type === 'FAT';
    if (activeItem.id === 'splitter') return e.type === 'Fiber Splitter';
    if (activeItem.id.includes('pole')) return e.type.includes('Pole');
    if (activeItem.id === 'ont') return e.type === 'ONT';
    return false;
  });

  const handleLocateOnMap = () => {
    if (matchingPlacedEquipment) {
      onClose();
      openView('map');
      setTimeout(() => {
        flyToLocation(matchingPlacedEquipment.lat, matchingPlacedEquipment.lng, 18);
        showToast(
          'success',
          'Located Asset',
          `Centered on ${matchingPlacedEquipment.name} (${matchingPlacedEquipment.area})`,
        );
      }, 150);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* Top Google-Style Search Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shrink-0 border-b border-indigo-950/50">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-inner">
                <BookOpen className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                    FiberGIS Knowledge & Equipment Discovery
                  </h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                    Google-Like Experience
                  </span>
                </div>
                <p className="text-xs text-blue-200/80">
                  Search what any network equipment is, how it functions, where it installs, and how FTTH connections
                  work.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Google-Style Search Input Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5 text-blue-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search equipment or ask a question (e.g. 'What is an FDMS?', 'What is a GPON OLT?', 'FAT box', 'Splitter')..."
              className="w-full pl-12 pr-10 py-3.5 bg-white text-slate-900 text-sm font-medium rounded-2xl shadow-lg border border-white/30 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-400/40 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Clickable Suggestions Pills */}
          <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1 no-scrollbar text-xs">
            <span className="text-blue-300 font-bold shrink-0 text-[11px]">Popular Searches:</span>
            {popularQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setSearchQuery(q.query);
                  const results = searchEquipmentKnowledge(q.query);
                  if (results.length > 0) setActiveItemSlug(results[0].id);
                }}
                className="shrink-0 px-2.5 py-1 bg-white/10 hover:bg-white/25 active:bg-blue-600 border border-white/15 rounded-lg text-[11px] font-medium text-blue-100 transition-colors whitespace-nowrap"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills & FTTH Workflow Progress Bar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
            {[
              'All',
              'Central Office',
              'Fiber Distribution',
              'Supporting Infrastructure',
              'Customer Equipment',
              'Cable TV',
              'Comparison Guide',
            ].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap text-xs ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Mode Switcher (Beginner vs Network Engineer) */}
          <div className="bg-white p-1 rounded-xl border border-slate-200 flex items-center gap-1 text-xs font-bold shadow-xs">
            <button
              onClick={() => setViewMode('beginner')}
              className={`px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                viewMode === 'beginner' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>👶 Simple Overview</span>
            </button>
            <button
              onClick={() => setViewMode('engineer')}
              className={`px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                viewMode === 'engineer' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>🔬 Engineer Specs</span>
            </button>
          </div>
        </div>

        {/* Main Body: Two-Column Split (List on Left, Rich Dossier on Right) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Equipment Catalog List */}
          <div className="w-72 sm:w-80 border-r border-slate-200 bg-slate-50/60 overflow-y-auto shrink-0 p-3 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
              Found {filteredItems.length} Knowledge Topics
            </div>
            {filteredItems.map((item) => {
              const isSelected = activeItem.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveItemSlug(item.id)}
                  className={`w-full text-left p-3 rounded-2xl transition-all border flex items-start gap-3 ${
                    isSelected
                      ? 'bg-white border-blue-500 shadow-md ring-2 ring-blue-400/20'
                      : 'bg-white/80 hover:bg-white border-slate-200/80 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-xs ${
                      item.category === 'Central Office'
                        ? 'bg-blue-100 text-blue-800'
                        : item.category === 'Fiber Distribution'
                          ? 'bg-teal-100 text-teal-800'
                          : item.category === 'Customer Equipment'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.category === 'Supporting Infrastructure'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-purple-100 text-purple-800'
                    }`}
                  >
                    {item.id === 'olt'
                      ? 'OLT'
                      : item.id === 'odf'
                        ? 'ODF'
                        : item.id === 'fdms'
                          ? 'FDM'
                          : item.id === 'fat'
                            ? 'FAT'
                            : item.id === 'splitter'
                              ? '1:N'
                              : item.id === 'ont'
                                ? 'ONT'
                                : item.id.includes('pole')
                                  ? 'POLE'
                                  : 'INFO'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className={`text-xs font-bold truncate ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                        {item.name}
                      </h4>
                      {item.ftthStep > 0 && (
                        <span className="text-[10px] font-semibold text-slate-400 shrink-0">Step {item.ftthStep}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5 leading-snug">
                      {item.beginnerSummary}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {item.category}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Column: Detailed Equipment Information Page */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-white">
            {/* Dossier Header */}
            <div className="pb-5 border-b border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                    {activeItem.category}
                  </span>
                  {activeItem.ftthStep > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {activeItem.ftthStepName}
                    </span>
                  )}
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                    {activeItem.badge}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {matchingPlacedEquipment && (
                    <button
                      onClick={handleLocateOnMap}
                      className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200 flex items-center gap-1.5 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Locate on Map ({matchingPlacedEquipment.name})</span>
                    </button>
                  )}
                  <button
                    onClick={handlePlaceOnMap}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors"
                  >
                    <span>➕ Place on GIS Map</span>
                  </button>
                </div>
              </div>

              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                {activeItem.name}
              </h1>
              {activeItem.fullForm && (
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  Full Form: <span className="text-slate-800 font-bold">{activeItem.fullForm}</span>
                </p>
              )}
            </div>

            {/* FTTH Step Visual Sequence */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>FTTH End-to-End Network Chain: Where does this fit?</span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs font-bold">
                {ftthFlow.map((node, index) => {
                  const isCurrent =
                    activeItem.id === node.id ||
                    (activeItem.id.includes('olt') && node.id === 'olt') ||
                    (activeItem.id.includes('pole') && node.id === 'telecom-pole');
                  return (
                    <React.Fragment key={node.id}>
                      <button
                        onClick={() => setActiveItemSlug(node.id)}
                        className={`px-3 py-1.5 rounded-xl shrink-0 transition-all flex items-center gap-1 border ${
                          isCurrent
                            ? 'bg-blue-600 text-white border-blue-700 shadow-sm ring-2 ring-blue-300'
                            : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span>{node.name}</span>
                        {isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
                      </button>
                      {index < ftthFlow.length - 1 && (
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mx-0.5" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Beginner View vs Technical View */}
            {viewMode === 'beginner' ? (
              /* Beginner Mode */
              <div className="space-y-6">
                {/* 1. What It Is (Simple English) */}
                <div className="p-5 bg-blue-50/70 border border-blue-100 rounded-2xl">
                  <div className="flex items-center gap-2 text-blue-900 font-bold text-sm mb-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Simple Explanation: What is this equipment?</span>
                  </div>
                  <p className="text-sm text-slate-800 leading-relaxed font-medium">{activeItem.beginnerSummary}</p>
                </div>

                {/* 2. Main Purpose & What It Is Used For */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>What is it used for?</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeItem.whatItIsUsedFor.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-700 flex items-start gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Where It Is Installed (Real World Location) */}
                <div className="p-4 bg-amber-50/60 border border-amber-200/80 rounded-2xl flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-900">Where is it installed in the real world?</h4>
                    <p className="text-xs text-amber-950 mt-1 leading-relaxed">{activeItem.whereInstalled}</p>
                  </div>
                </div>
              </div>
            ) : (
              /* Engineer Deep Dive Mode */
              <div className="space-y-6">
                {/* Engineering Working Principles */}
                <div className="p-5 bg-slate-900 text-white rounded-2xl border border-slate-800">
                  <div className="flex items-center gap-2 text-blue-300 font-bold text-sm mb-2">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    <span>Engineering Operation & Physical Layer Architecture</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-mono">{activeItem.engineerSummary}</p>
                  <p className="text-xs text-slate-400 leading-relaxed mt-2.5">{activeItem.howItWorks}</p>
                </div>

                {/* Port & Optical Specifications */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 font-bold text-xs text-slate-800">
                    Hardware Port Specifications
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-xs">
                    <div className="p-3 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Port Capacity:</span>
                        <span className="font-semibold text-slate-900">
                          {activeItem.portSpecifications.totalTypicalPorts}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Connector Interface:</span>
                        <span className="font-semibold text-slate-900">
                          {activeItem.portSpecifications.connectorTypes}
                        </span>
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Standards:</span>
                        <span className="font-semibold text-slate-900">
                          {activeItem.portSpecifications.protocolStandards}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Wavelengths:</span>
                        <span className="font-semibold text-slate-900">
                          {activeItem.portSpecifications.wavelengths}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Technical Specifications Table */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 font-bold text-xs text-slate-800">
                    Key Telecommunication Specifications
                  </div>
                  <table className="w-full text-xs text-left">
                    <tbody className="divide-y divide-slate-200">
                      {activeItem.technicalSpecs.map((spec, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-600 w-1/2">{spec.label}</td>
                          <td className="px-4 py-2.5 font-bold text-slate-900">{spec.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Inputs & Outputs (Connection Diagram) */}
            <div className="border border-slate-200 rounded-2xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
                <Cable className="w-3.5 h-3.5 text-blue-600" />
                <span>How It Connects To Other Equipment</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-emerald-50 border border-emerald-200/80 rounded-xl">
                  <div className="font-bold text-emerald-900 mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    <span>Inputs (Coming In):</span>
                  </div>
                  <ul className="space-y-1 text-emerald-950 font-medium">
                    {activeItem.howItConnects.inputs.map((inp, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span>&bull;</span>
                        <span>{inp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200/80 rounded-xl">
                  <div className="font-bold text-blue-900 mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>Outputs (Going Out):</span>
                  </div>
                  <ul className="space-y-1 text-blue-950 font-medium">
                    {activeItem.howItConnects.outputs.map((out, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span>&bull;</span>
                        <span>{out}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Common Manufacturer Hardware Models */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-indigo-600" />
                <span>Common Real-World Vendor Hardware Models</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {activeItem.commonModels.map((model, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition-colors"
                  >
                    {model}
                  </span>
                ))}
              </div>
            </div>

            {/* Practical Installation Tips & Field Best Practices */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Practical Field Installation Rules & Precautions</span>
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-700">
                {activeItem.practicalInstallationTips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Related Equipment Clickable Links */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                Related Equipment & Next Steps
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeItem.relatedEquipment.map((rel) => (
                  <button
                    key={rel.id}
                    onClick={() => setActiveItemSlug(rel.id)}
                    className="p-3 bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 rounded-xl text-left transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900 group-hover:text-blue-700 flex items-center gap-1">
                        <span>{rel.name}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{rel.relationship}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Frequently Asked Questions */}
            {activeItem.faq && activeItem.faq.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Frequently Asked Questions</span>
                </h3>
                <div className="space-y-2">
                  {activeItem.faq.map((f, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-900">Q: {f.question}</div>
                      <div className="text-slate-600 font-normal">A: {f.answer}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>FiberGIS Local Knowledge Engine &bull; Verified FTTH Telecommunications Standards</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors"
          >
            Close Knowledge Base
          </button>
        </div>
      </div>
    </div>
  );
};
