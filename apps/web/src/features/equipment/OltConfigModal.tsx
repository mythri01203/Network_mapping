import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cable as CableIcon,
  Check,
  Copy,
  Cpu,
  FileText,
  Network,
  Palette,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Server,
  Sparkles,
  Split,
  Trash2,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  buildOltLogicalPorts,
  buildOltPonPorts,
  type CableType,
  customersOnPonPort,
  type Equipment,
  type EquipmentPort,
  generateOltDescription,
  isCustomerTerminal,
  MAX_OLT_PON_PORTS,
  type OltConfig,
  pickerEntries,
  PON_TECHNOLOGIES,
  type PonTechnology,
  type SplitterRatio,
  STANDARD_PORT_COLORS,
  validateOltConfig,
} from '@fibergis/shared';

import { requestConfirm } from '../../stores/confirmStore';
import { addSplitter } from '../../stores/fiberActions';
import { useMapStore } from '../../stores/mapStore';
import { updateEquipment } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

type ConfigTab = 'basic' | 'tech' | 'ports' | 'colors' | 'splitters' | 'cables' | 'summary';

/** Outputs of an equal splitter, read from its ratio ("1:8" → 8). */
const outputsOf = (ratio: string): number | undefined => {
  const n = Number(ratio.split(':')[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Phase 10: names offered while typing the make. Any other name can be typed; nothing is chosen for the person. */
const OLT_MANUFACTURERS = [
  'Syrotech',
  'Huawei',
  'ZTE',
  'Nokia',
  'BDCom',
  'FiberHome',
  'VSOL',
  'Cisco',
  'Ubiquiti',
  'MikroTik',
];

const CORE_COUNT_PRESETS = [2, 4, 6, 12, 24, 48, 96];

export const OltConfigModal: React.FC = () => {
  const { isOpen, olt, closeOltConfigModal } = useUiStore(
    useShallow((s) => ({
      isOpen: s.modals.oltConfig,
      olt: s.selectedOltForConfig,
      closeOltConfigModal: s.closeOltConfigModal,
    })),
  );

  const { allEquipment, allCables, networkSplitters, allCustomers, settings } = useNetworkStore(
    useShallow((s) => ({
      allEquipment: s.equipment,
      allCables: s.cables,
      networkSplitters: s.splitters,
      allCustomers: s.customers,
      settings: s.settings,
    })),
  );
  // Phase 23 editable list: the owner's names for the ratios. The ratio values themselves are fixed.
  const ratioEntries = pickerEntries('splitterRatios', settings);
  // Makes offered while typing: the common names plus any already written on this network.
  const makeSuggestions = [...new Set([...OLT_MANUFACTURERS, ...allEquipment.filter((e) => e.type === 'OLT' && e.manufacturer?.trim()).map((e) => e.manufacturer!.trim())])];

  const [activeTab, setActiveTab] = useState<ConfigTab>('basic');

  // Form State
  const [name, setName] = useState('');
  const [oltId, setOltId] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [area, setArea] = useState('');
  const [street, setStreet] = useState('');
  const [technology, setTechnology] = useState<PonTechnology>('GPON');
  // Phase 10: any count the person reads off the OLT (such as 12). 0 means not entered yet.
  const [totalPorts, setTotalPorts] = useState(0);
  const [portCountText, setPortCountText] = useState('');
  const [portColorMap, setPortColorMap] = useState<Record<string, string>>({});

  // Splitters state
  const [splitters, setSplitters] = useState<
    Array<{
      id: string;
      name?: string;
      ratio: SplitterRatio;
      inPort: string;
      parentPonPort?: string;
      outPortsCount: number;
      color?: string;
      targetEquipmentId?: string;
    }>
  >([]);

  // Splitter proposal form
  const [newSplitterRatio, setNewSplitterRatio] = useState<SplitterRatio>('1:8');
  const [newSplitterPonPort, setNewSplitterPonPort] = useState('PON-01');
  const [newSplitterColor, setNewSplitterColor] = useState('Blue');
  const [newSplitterTerminalId, setNewSplitterTerminalId] = useState('');

  // Cable drawing form
  const [cablePonPort, setCablePonPort] = useState('PON-01');
  const [cableTargetEqId, setCableTargetEqId] = useState('');
  const [cableTargetPort, setCableTargetPort] = useState('IN-01');
  const [cableCoreCount, setCableCoreCount] = useState(12);
  const [cableColorHex, setCableColorHex] = useState('#0284c7');
  const [cableType, setCableType] = useState('Main Feeder Fiber');

  // Copy status
  const [copied, setCopied] = useState(false);

  // Initialize form whenever modal opens with an OLT
  useEffect(() => {
    if (!olt) return;

    setName(olt.name);
    setOltId(olt.id);
    setManufacturer(olt.manufacturer || '');
    setModel(olt.model || '');
    setArea(olt.area || '');
    setStreet(olt.street || '');

    // Keep the recorded technology, including XGS-PON and 10G-EPON. GPON is only the shown starting choice.
    setTechnology(olt.technology ?? 'GPON');

    // Phase 10: the recorded count, or nothing. No count is assumed for a new OLT.
    const portCount = olt.ponPorts?.length || olt.totalPorts || 0;
    setTotalPorts(portCount);
    setPortCountText(portCount ? String(portCount) : '');

    // Initialize port colors
    const colors: Record<string, string> = { ...(olt.portColorMap || {}) };
    for (let i = 1; i <= portCount; i++) {
      const portCode = `PON-${String(i).padStart(2, '0')}`;
      if (!colors[portCode]) {
        colors[portCode] = STANDARD_PORT_COLORS[(i - 1) % STANDARD_PORT_COLORS.length].name;
      }
    }
    setPortColorMap(colors);

    // Initialize splitters
    if (olt.oltConfig?.splitters) {
      setSplitters(olt.oltConfig.splitters);
    } else {
      // Find downstream splitters already connected to this OLT. The PON port is only what the cable
      // records as its start port; a port is never guessed from the list order.
      const downstream = allEquipment.filter(
        (e) => e.type.includes('Splitter') && allCables.some((c) => c.startEquipmentId === olt.id && c.endEquipmentId === e.id),
      );
      setSplitters(
        downstream
          .filter((s) => !!s.splitterConfig?.ratio)
          .flatMap((s) => {
            const ratio = s.splitterConfig!.ratio as SplitterRatio;
            const outs = outputsOf(ratio) ?? s.totalPorts;
            if (!outs) return [];
            const startPort = allCables.find((c) => c.startEquipmentId === olt.id && c.endEquipmentId === s.id)?.startPortName;
            return [{ id: s.id, name: s.name, ratio, inPort: 'IN-01', ...(startPort ? { parentPonPort: startPort } : {}), outPortsCount: outs }];
          }),
      );
    }

    setActiveTab('basic');
  }, [olt, allEquipment, allCables]);

  // Dynamically generated OLT Description
  const generatedDescription = useMemo(() => {
    return generateOltDescription({
      name,
      id: oltId,
      technology,
      manufacturer,
      model,
      area,
      street,
      totalPorts,
      portColorMap,
      splitters,
      cables: allCables
        .filter((c) => c.startEquipmentId === oltId)
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          coreCount: c.fiberCount,
          colorHex: c.colorHex,
          ponPort: c.startPortName || undefined,
          lengthMeters: c.lengthMeters,
        })),
    });
  }, [name, oltId, technology, manufacturer, model, area, street, totalPorts, portColorMap, splitters, allCables]);

  if (!isOpen || !olt) return null;

  const handleApplyRainbowColors = () => {
    const updated: Record<string, string> = {};
    for (let i = 1; i <= totalPorts; i++) {
      const portCode = `PON-${String(i).padStart(2, '0')}`;
      updated[portCode] = STANDARD_PORT_COLORS[(i - 1) % STANDARD_PORT_COLORS.length].name;
    }
    setPortColorMap(updated);
    showToast('success', 'Color Scheme Applied', 'Applied TIA-598 standard sequence across all PON ports.');
  };

  /** Phase 10: adds a splitter to the plan only. No splitter record is made until the person confirms one. */
  const handleAddSplitter = () => {
    const outputs = outputsOf(newSplitterRatio);
    if (!outputs) return;
    const newId = `SPL-${technology.replace(/\s+/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const destination = newSplitterTerminalId ? ` → ${newSplitterTerminalId}` : '';

    const newSplItem = {
      id: newId,
      name: `${newSplitterRatio} Optical Splitter (${newSplitterPonPort}${destination})`,
      ratio: newSplitterRatio,
      inPort: 'IN-01',
      parentPonPort: newSplitterPonPort,
      outPortsCount: outputs,
      color: newSplitterColor,
      targetEquipmentId: newSplitterTerminalId || undefined,
    };

    setSplitters((prev) => [...prev, newSplItem]);
    showToast('info', 'Splitter proposed', `A ${newSplitterRatio} splitter on ${newSplitterPonPort} is in the plan. It is not a record yet: use "Create splitter record" when it is installed.`);
  };

  /** Phase 10: makes the splitter record for one proposal, after the person confirms. */
  const handleCreateSplitter = async (proposal: (typeof splitters)[number]) => {
    const box = allEquipment.find((e) => e.id === proposal.targetEquipmentId);
    if (!box) {
      showToast('warning', 'Choose the box first', 'A splitter record needs the terminal box it is installed in. Remove this proposal and add it again with the box.');
      return;
    }
    const yes = await requestConfirm({
      title: 'Create the splitter record?',
      message: `This makes splitter ${proposal.id} (${proposal.ratio}) in ${box.name}. Its input fiber is not linked: link it on the splitter in the box once you know which fiber feeds it.`,
      confirmLabel: 'Create splitter',
      tone: 'default',
    });
    if (!yes) return;
    await addSplitter({ id: proposal.id, name: proposal.name, terminalBoxId: box.id, ratio: proposal.ratio });
  };

  const handleRemoveSplitter = (id: string) => {
    if (networkSplitters.some((s) => s.id === id)) {
      showToast('warning', 'Splitter Installed', `${id} is already installed in a terminal box and stays in the network.`);
      return;
    }
    setSplitters((prev) => prev.filter((s) => s.id !== id));
  };

  const handleStartCableDrawing = () => {
    const linkedPon = allEquipment
      .find((e) => e.id === olt.id)
      ?.ponPorts?.find((p) => p.id === cablePonPort)?.connectedFeederCableId;
    if (linkedPon) {
      showToast('error', 'PON Port In Use', `${cablePonPort} already feeds cable ${linkedPon}. Choose another port.`);
      return;
    }
    // The cable needs the saved PON ports, and drawing closes this dialog.
    if (!saveConfig()) return;
    closeOltConfigModal();

    const map = useMapStore.getState();
    map.setCableTypeToDraw(cableType as CableType);
    map.setCableDraftDefaults({
      startEquipmentId: olt.id,
      endEquipmentId: cableTargetEqId || undefined,
      startPortName: cablePonPort,
      endPortName: cableTargetPort,
      fiberCount: cableCoreCount,
      colorHex: cableColorHex,
    });
    map.setDrawingPoints([[olt.lat, olt.lng]]);
    map.setActiveTool('draw_cable');

    showToast(
      'info',
      'Cable Route Drawing Active',
      `The route starts at ${name} (${cablePonPort}). Click along the path, finish on the destination, then press Enter.`,
    );
  };

  /** Writes the form to the network. Returns `false` if validation failed. */
  const saveConfig = (): boolean => {
    const validation = validateOltConfig({
      technology,
      totalPorts,
      oltConfig: {
        technology,
        ponPortCount: totalPorts,
      },
    });

    if (!validation.valid) {
      showToast('error', 'Validation Error', validation.errors.join(' '));
      return false;
    }

    // Edit the live record: other work may have changed this OLT since the dialog opened.
    const current = allEquipment.find((e) => e.id === olt.id) ?? olt;
    // Phase 10: customers are counted from their records, not from the stored counter.
    const stranded = current.ponPorts?.find(
      (p) => p.portNumber > totalPorts && (p.connectedFeederCableId || customersOnPonPort(allCustomers, current.id, p.id).length > 0),
    );
    if (stranded) {
      showToast('error', 'PON Port In Use', `${stranded.id} is still connected, so the OLT needs at least ${stranded.portNumber} ports.`);
      return false;
    }
    const keptIds = new Set(buildOltPonPorts(current, totalPorts).map((p) => p.id));
    const onCard = current.chassis?.shelves.flatMap((s) => s.slots.flatMap((l) => (l.card?.ponPortIds ?? []).filter((id) => !keptIds.has(id)).map((id) => `${id} (shelf ${s.label} slot ${l.label})`)));
    if (onCard?.length) {
      showToast('error', 'PON Port On A Card', `${onCard[0]} is recorded on a card. Take it off the card in "Chassis: shelves, slots and cards" first, or keep more ports.`);
      return false;
    }

    const ponPorts = buildOltPonPorts({ ...current, technology, portColorMap }, totalPorts);
    const usedPons = ponPorts.filter((p) => p.status === 'Active').length;
    const logicalPorts: EquipmentPort[] = buildOltLogicalPorts(oltId, totalPorts, technology, portColorMap).map((port) => {
      const pon = ponPorts.find((p) => p.portNumber === port.portNumber);
      return {
        ...port,
        status: pon?.status === 'Active' ? 'Used' : pon?.status === 'Faulty' ? 'Damaged' : port.status,
        connectedCableId: pon?.connectedFeederCableId,
      };
    });

    const oltConfigData: OltConfig = {
      technology,
      ponPortCount: totalPorts,
      portColors: portColorMap,
      splitters,
      description: generatedDescription,
    };

    const updatedOlt: Equipment = {
      ...current,
      name: name.trim() || current.name,
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      technology,
      totalPorts,
      usedPorts: usedPons,
      availablePorts: totalPorts - usedPons,
      area: area || current.area,
      street: street || current.street,
      // Phase 10: the generated description is kept in oltConfig.description; the person's own notes stay.
      portColorMap,
      oltConfig: oltConfigData,
      ponPorts,
      logicalPorts,
    };

    // Phase 10: saving no longer creates splitter records. Proposals stay in the plan until the
    // person presses "Create splitter record" on one and confirms.
    if (!updateEquipment(updatedOlt)) return false;
    const waiting = splitters.filter((s) => !networkSplitters.some((n) => n.id === s.id)).length;
    showToast(
      'success',
      'OLT Configuration Saved',
      `Updated ${name} with ${technology} and ${totalPorts} PON ports.${waiting ? ` ${waiting} proposed splitter(s) are not records yet.` : ''}`,
    );
    return true;
  };

  const handleSave = () => {
    if (saveConfig()) closeOltConfigModal();
  };

  const handleCopyDescription = () => {
    navigator.clipboard.writeText(generatedDescription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('info', 'Copied to Clipboard', 'OLT technical description copied.');
  };

  return (
    <div className="modal-sheet fixed inset-0 z-[1600] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl text-white flex flex-col overflow-hidden my-auto max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Dynamic OLT Configuration</h2>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    technology === 'GPON'
                      ? 'bg-blue-950 text-blue-400 border-blue-500/40'
                      : 'bg-emerald-950 text-emerald-400 border-emerald-500/40'
                  }`}
                >
                  {technology} Mode
                </span>
                <span className="text-[11px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                  {oltId}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Configure PON optics, port color codes, distribution splitters & live cable routes
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeOltConfigModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 bg-slate-950/80 border-b border-slate-800 flex gap-2 overflow-x-auto no-scrollbar text-xs font-medium">
          {[
            { id: 'basic', label: '1. Basic Details', icon: Server },
            { id: 'tech', label: '2. Technology', icon: Radio },
            { id: 'ports', label: '3. PON Ports', icon: Network },
            { id: 'colors', label: '4. Port Colors', icon: Palette },
            { id: 'splitters', label: '5. Splitters', icon: Split },
            { id: 'cables', label: '6. Cable Config', icon: CableIcon },
            { id: 'summary', label: '7. Description / Spec', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ConfigTab)}
                className={`py-3 px-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-sky-500 text-sky-400 font-bold bg-sky-500/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {/* TAB 1: BASIC DETAILS */}
          {activeTab === 'basic' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">OLT Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Central Telco Hub OLT-01"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">OLT ID (Auto-generated)</label>
                  <input
                    type="text"
                    value={oltId}
                    onChange={(e) => setOltId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono text-sky-300 outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label htmlFor="olt-make" className="block text-xs font-semibold text-slate-300 mb-1.5">Manufacturer (as on the OLT label)</label>
                  {/* Phase 10: free text. The list only offers names while typing; blank is "Not recorded". */}
                  <input
                    id="olt-make"
                    type="text"
                    list="olt-make-suggestions"
                    data-testid="olt-make"
                    value={manufacturer}
                    maxLength={80}
                    onChange={(e) => setManufacturer(e.target.value)}
                    placeholder="Not recorded"
                    className="w-full min-h-12 md:min-h-9 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm md:text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                  <datalist id="olt-make-suggestions">
                    {makeSuggestions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Model Number</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. GPON 8-Port OLT (Syrotech V1600G1)"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Location Area</label>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="e.g. Sector 5 Telecom Zone"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Street Address</label>
                  <input
                    type="text"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    placeholder="e.g. 100 Feet Ring Road"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Geographic Coordinates</span>
                </div>
                <p className="text-xs font-mono text-slate-400">
                  Latitude: {olt.lat.toFixed(6)}, Longitude: {olt.lng.toFixed(6)}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: TECHNOLOGY SELECTION */}
          {activeTab === 'tech' && (
            <div className="space-y-4 animate-in fade-in">
              <p className="text-xs text-slate-400">
                Select optical transmission architecture. All port capacities, split ratios, and transceiver optics will
                adapt dynamically.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* GPON Card */}
                <div
                  onClick={() => setTechnology('GPON')}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    technology === 'GPON'
                      ? 'bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm text-white flex items-center gap-2">
                      <Radio className="w-4 h-4 text-blue-400" /> GPON (ITU-T G.984)
                    </span>
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                        technology === 'GPON' ? 'bg-blue-600 border-blue-400 text-white' : 'border-slate-700'
                      }`}
                    >
                      {technology === 'GPON' && <Check className="w-3 h-3" />}
                    </span>
                  </div>

                  <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                    <li>
                      <strong className="text-white">Downstream:</strong> 2.488 Gbps (1490nm)
                    </li>
                    <li>
                      <strong className="text-white">Upstream:</strong> 1.244 Gbps (1310nm)
                    </li>
                    <li>
                      <strong className="text-white">Optical Split:</strong> Up to 1:128 subscribers per PON port
                    </li>
                    <li>
                      <strong className="text-white">Transceiver Class:</strong> Class B+ / C+ (+1.5 dBm to +5.0 dBm Tx)
                    </li>
                    <li>
                      <strong className="text-white">Max Link Reach:</strong> 20 km standard (up to 40km with FEC)
                    </li>
                  </ul>
                </div>

                {/* EPON Card */}
                <div
                  onClick={() => setTechnology('EPON')}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    technology === 'EPON'
                      ? 'bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/30'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm text-white flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-emerald-400" /> EPON (IEEE 802.3ah)
                    </span>
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                        technology === 'EPON' ? 'bg-emerald-600 border-emerald-400 text-white' : 'border-slate-700'
                      }`}
                    >
                      {technology === 'EPON' && <Check className="w-3 h-3" />}
                    </span>
                  </div>

                  <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                    <li>
                      <strong className="text-white">Downstream:</strong> 1.25 Gbps Symmetric (1490nm)
                    </li>
                    <li>
                      <strong className="text-white">Upstream:</strong> 1.25 Gbps Symmetric (1310nm)
                    </li>
                    <li>
                      <strong className="text-white">Optical Split:</strong> Up to 1:64 subscribers per PON port
                    </li>
                    <li>
                      <strong className="text-white">Transceiver Class:</strong> PX20+ / PX20+++ (+2.0 dBm to +7.0 dBm Tx)
                    </li>
                    <li>
                      <strong className="text-white">Max Link Reach:</strong> 20 km standard
                    </li>
                  </ul>
                </div>
              </div>

              <label className="block text-xs text-slate-300">
                <span className="mb-1.5 block font-semibold">Other PON technology</span>
                <select
                  aria-label="Other PON technology"
                  value={technology === 'GPON' || technology === 'EPON' ? '' : technology}
                  onChange={(e) => e.target.value && setTechnology(e.target.value as PonTechnology)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-sky-500 md:w-72"
                >
                  <option value="">GPON or EPON (choose above)</option>
                  {PON_TECHNOLOGIES.filter((t) => t !== 'GPON' && t !== 'EPON').map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Compatibility Rule:</strong> Switching between GPON and EPON updates all port type headers.
                  Existing connected ONUs will be validated against this standard.
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: PON PORTS */}
          {activeTab === 'ports' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                {/* Phase 10: any count, such as 12. Nothing is chosen for the person. */}
                <label htmlFor="olt-pon-count" className="block">
                  <span className="block text-xs font-semibold text-slate-200">How many PON ports does this OLT have?</span>
                  <span className="text-[11px] text-slate-400">Count them on the front of the OLT. Any number from 1 to {MAX_OLT_PON_PORTS}.</span>
                </label>

                <input
                  id="olt-pon-count"
                  data-testid="olt-pon-count"
                  type="text"
                  inputMode="numeric"
                  value={portCountText}
                  onChange={(e) => {
                    const text = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPortCountText(text);
                    setTotalPorts(text ? Number(text) : 0);
                  }}
                  placeholder="Not recorded"
                  className="w-32 min-h-12 md:min-h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-base md:text-sm text-center text-white outline-none focus:border-sky-500 font-mono"
                />
                {totalPorts > MAX_OLT_PON_PORTS && (
                  <p className="w-full text-xs text-rose-300">More than {MAX_OLT_PON_PORTS} ports is not possible for one OLT here. Check the number.</p>
                )}
              </div>

              {/* Port Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 grid grid-cols-12 gap-2 text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                  <span className="col-span-3">Port Code</span>
                  <span className="col-span-3">Type & ONU limit</span>
                  <span className="col-span-3">Color Assignment</span>
                  <span className="col-span-3 text-right">Status</span>
                </div>

                <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                  {totalPorts === 0 && <p className="px-4 py-3 text-xs text-slate-400">Enter the port count above to list the ports.</p>}
                  {Array.from({ length: Math.min(totalPorts, MAX_OLT_PON_PORTS) }, (_, i) => {
                    const portNumber = i + 1;
                    const pad = String(portNumber).padStart(2, '0');
                    const code = `PON-${pad}`;
                    const assignedColor = portColorMap[code] || STANDARD_PORT_COLORS[i % STANDARD_PORT_COLORS.length].name;
                    const hex = STANDARD_PORT_COLORS.find((c) => c.name === assignedColor)?.hex || '#0284c7';
                    // Phase 10: the port as recorded, or "New" for a port this save would add.
                    const recorded = (allEquipment.find((e) => e.id === olt.id) ?? olt).ponPorts?.find((p) => p.portNumber === portNumber);

                    return (
                      <div key={code} className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-xs hover:bg-slate-900/40">
                        <span className="col-span-3 font-mono font-bold text-sky-400 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hex }} />
                          {code}
                        </span>

                        <span className="col-span-3 text-slate-300">
                          {recorded?.technology ?? technology} · {recorded?.maxOnu !== undefined ? `${recorded.maxOnu} ONUs` : 'limit not recorded'}
                        </span>

                        <span className="col-span-3 font-medium text-slate-300 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
                          {assignedColor}
                        </span>

                        <span className="col-span-3 text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 text-slate-300 border border-slate-700">
                            {recorded ? recorded.status : 'New'}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PORT COLORS */}
          {activeTab === 'colors' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white">Port Color Coding (TIA-598 Standard)</h3>
                  <p className="text-[11px] text-slate-400">
                    Assign individual colors to each PON port. This color is inherited by feeder cables and traces.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleApplyRainbowColors}
                  className="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Apply Standard Sequence</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto p-1">
                {Array.from({ length: totalPorts }, (_, i) => {
                  const portNumber = i + 1;
                  const pad = String(portNumber).padStart(2, '0');
                  const code = `PON-${pad}`;
                  const currentColorName = portColorMap[code] || STANDARD_PORT_COLORS[i % STANDARD_PORT_COLORS.length].name;
                  const currentHex = STANDARD_PORT_COLORS.find((c) => c.name === currentColorName)?.hex || '#0284c7';

                  return (
                    <div key={code} className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{code}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-slate-300" style={{ backgroundColor: `${currentHex}33`, borderColor: currentHex }}>
                          {currentColorName}
                        </span>
                      </div>

                      <div className="grid grid-cols-6 gap-1">
                        {STANDARD_PORT_COLORS.map((col) => {
                          const isSelected = currentColorName === col.name;
                          return (
                            <button
                              key={col.name}
                              type="button"
                              onClick={() => {
                                setPortColorMap((prev) => ({
                                  ...prev,
                                  [code]: col.name,
                                }));
                              }}
                              className={`h-5 w-5 rounded-full border transition-transform ${
                                isSelected ? 'scale-125 ring-2 ring-white border-white' : 'border-black/40 hover:scale-110'
                              }`}
                              style={{ backgroundColor: col.hex }}
                              title={`${col.number}. ${col.name}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 5: SPLITTER CONFIGURATION */}
          {activeTab === 'splitters' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <Split className="w-4 h-4 text-purple-400" />
                    <span>Propose a splitter</span>
                  </span>
                  <span className="text-[11px] text-slate-400">A plan only. No splitter record is made until you create it below.</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Split Ratio</label>
                    <select
                      value={newSplitterRatio}
                      onChange={(e) => setNewSplitterRatio(e.target.value as SplitterRatio)}
                      className="w-full min-h-12 md:min-h-9 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-purple-500"
                    >
                      {ratioEntries
                        .filter((r) => outputsOf(r.value))
                        .map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                            {r.label !== r.value ? ` (${r.value})` : ''} · {outputsOf(r.value)} outputs
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Parent OLT PON Port</label>
                    <select
                      value={newSplitterPonPort}
                      onChange={(e) => setNewSplitterPonPort(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-purple-500 font-mono"
                    >
                      {Array.from({ length: totalPorts }, (_, i) => {
                        const code = `PON-${String(i + 1).padStart(2, '0')}`;
                        return (
                          <option key={code} value={code}>
                            {code} ({portColorMap[code] || 'Standard'})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Splitter Color Tag</label>
                    <select
                      value={newSplitterColor}
                      onChange={(e) => setNewSplitterColor(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-purple-500"
                    >
                      {STANDARD_PORT_COLORS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Install in Terminal Box</label>
                  <select
                    value={newSplitterTerminalId}
                    onChange={(e) => setNewSplitterTerminalId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-purple-500"
                  >
                    <option value="">Not decided yet</option>
                    {allEquipment
                      .filter((e) => isCustomerTerminal(e.type))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.id})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleAddSplitter}
                    disabled={totalPorts === 0}
                    className="min-h-12 md:min-h-9 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-md"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add to the plan</span>
                  </button>
                </div>
              </div>

              {/* Splitters list */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300 block">
                  Splitter plan ({splitters.length})
                </span>

                {splitters.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-4 text-center bg-slate-950/40 rounded-xl border border-slate-800">
                    No splitters planned for this OLT yet. Propose one above.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {splitters.map((spl) => {
                      const isRecord = networkSplitters.some((n) => n.id === spl.id);
                      const box = spl.targetEquipmentId ? allEquipment.find((e) => e.id === spl.targetEquipmentId) : undefined;
                      return (
                      <div
                        key={spl.id}
                        data-testid="olt-splitter-proposal"
                        className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-[11px] border border-purple-500/30">
                            {spl.ratio}
                          </div>
                          <div>
                            <div className="font-bold text-white flex items-center gap-2">
                              <span>{spl.id}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-purple-300 font-mono">
                                Inbound: {spl.inPort}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Fed by: <strong className="text-sky-400 font-mono">{spl.parentPonPort ?? 'PON port not recorded'}</strong> · {spl.outPortsCount} Output Branches (OUT-01 to OUT-{String(spl.outPortsCount).padStart(2, '0')})
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Box: {box ? box.name : spl.targetEquipmentId ? `${spl.targetEquipmentId} (not on the map)` : 'Not decided'} ·{' '}
                              {isRecord ? <span className="font-semibold text-emerald-400">Splitter record exists</span> : <span className="font-semibold text-amber-300">Proposed only</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!isRecord && (
                            <button
                              type="button"
                              data-testid="olt-splitter-create"
                              disabled={!box}
                              title={box ? undefined : 'Choose the box when proposing it'}
                              onClick={() => void handleCreateSplitter(spl)}
                              className="min-h-12 md:min-h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 disabled:text-slate-500 text-xs font-semibold"
                            >
                              Create splitter record
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveSplitter(spl.id)}
                            className="min-h-12 min-w-12 md:min-h-9 md:min-w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 transition-colors"
                            title="Remove from the plan"
                            aria-label="Remove from the plan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: CABLE CONFIGURATION & DRAWING */}
          {activeTab === 'cables' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <CableIcon className="w-4 h-4 text-sky-400" />
                  <span>Fiber Cable Drawing Setup</span>
                </span>
                <p className="text-[11px] text-slate-400">
                  Select starting OLT PON port, choose destination equipment, and click Draw Cable to map the route.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Starting PON Port</label>
                    <select
                      value={cablePonPort}
                      onChange={(e) => {
                        setCablePonPort(e.target.value);
                        const assignedCol = portColorMap[e.target.value];
                        const hex = STANDARD_PORT_COLORS.find((c) => c.name === assignedCol)?.hex;
                        if (hex) setCableColorHex(hex);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-sky-500 font-mono"
                    >
                      {Array.from({ length: totalPorts }, (_, i) => {
                        const code = `PON-${String(i + 1).padStart(2, '0')}`;
                        return (
                          <option key={code} value={code}>
                            {code} ({portColorMap[code] || 'Standard'})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Destination Target</label>
                    <select
                      value={cableTargetEqId}
                      onChange={(e) => setCableTargetEqId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-sky-500"
                    >
                      <option value="">-- Choose Target Equipment --</option>
                      {allEquipment
                        .filter((e) => e.id !== oltId)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} ({e.type})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Destination Inbound Port</label>
                    <input
                      type="text"
                      value={cableTargetPort}
                      onChange={(e) => setCableTargetPort(e.target.value)}
                      placeholder="e.g. IN-01 or PORT-01"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Cable Type</label>
                    <select
                      value={cableType}
                      onChange={(e) => setCableType(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-sky-500"
                    >
                      <option value="Main Feeder Fiber">Main Feeder Fiber</option>
                      <option value="Distribution Fiber">Distribution Fiber</option>
                      <option value="Drop Fiber">Drop Fiber</option>
                      <option value="Aerial Fiber">Aerial Fiber</option>
                      <option value="Underground Fiber">Underground Fiber</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Fiber Core Count</label>
                    <select
                      value={cableCoreCount}
                      onChange={(e) => setCableCoreCount(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white outline-none focus:border-sky-500 font-mono"
                    >
                      {CORE_COUNT_PRESETS.map((c) => (
                        <option key={c} value={c}>
                          {c} Cores
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Cable Color:</span>
                    <div className="flex gap-1.5">
                      {STANDARD_PORT_COLORS.slice(0, 8).map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setCableColorHex(c.hex)}
                          className={`w-5 h-5 rounded-full border ${
                            cableColorHex === c.hex ? 'ring-2 ring-white border-white scale-110' : 'border-black/40'
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStartCableDrawing}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-all"
                  >
                    <Route className="w-4 h-4" />
                    <span>Draw Cable Route on Map</span>
                  </button>
                </div>
              </div>

              {/* Existing connected cables */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300 block">
                  Active Connected Cables ({allCables.filter((c) => c.startEquipmentId === oltId).length})
                </span>
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                  {allCables
                    .filter((c) => c.startEquipmentId === oltId)
                    .map((c) => (
                      <div key={c.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/30">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: c.colorHex || '#0284c7' }}
                          />
                          <div>
                            <div className="font-bold text-white">{c.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {c.id} · {c.fiberCount} Cores · {c.lengthMeters.toFixed(0)}m · Start: {c.startPortName || 'port not recorded'}
                            </div>
                          </div>
                        </div>

                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {c.type}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: DYNAMIC DESCRIPTION & SPECIFICATION */}
          {activeTab === 'summary' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span>Dynamic Engineering Specification</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Automatically generated and saved into equipment description and database records.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyDescription}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Spec'}</span>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 font-mono text-xs text-sky-200 border border-slate-800 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto select-all">
                {generatedDescription}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              // Reset to initial
              if (olt) {
                setTechnology(olt.technology ?? 'GPON');
                const recordedCount = olt.ponPorts?.length || olt.totalPorts || 0;
                setTotalPorts(recordedCount);
                setPortCountText(recordedCount ? String(recordedCount) : '');
                setName(olt.name);
                setManufacturer(olt.manufacturer || '');
                showToast('info', 'Form Reset', 'Reverted unsaved draft changes.');
              }
            }}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Draft</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={closeOltConfigModal}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-all flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Save Configuration</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
