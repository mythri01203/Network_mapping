import React, { useMemo, useState } from 'react';
import { Check, Compass, GitMerge, PlugZap, Sparkles, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type Customer,
  type Equipment,
  getFiberColor,
  polylineLengthMeters,
  STANDARD_12_COLORS,
} from '@fibergis/shared';

import { Button, cn } from '../../components/ui';
import { addCable, updateCustomer } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const SpliceModal: React.FC = () => {
  const { isSpliceModalOpen, setModalOpen, selectedSpliceTarget } = useUiStore(
    useShallow((s) => ({
      isSpliceModalOpen: s.modals.spliceModal,
      setModalOpen: s.setModalOpen,
      selectedSpliceTarget: s.selectedSpliceTarget,
    })),
  );

  const { equipment, splitters, customers } = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      splitters: s.splitters,
      customers: s.customers,
    })),
  );

  const showToast = useToastStore((s) => s.show);

  // Form states
  const [selectedUpstreamId, setSelectedUpstreamId] = useState<string>('');
  const [selectedPortId, setSelectedPortId] = useState<string>('port-1');
  const [distanceMeters, setDistanceMeters] = useState<number>(85);
  const [selectedCoreNumber, setSelectedCoreNumber] = useState<number>(1);
  const [splicingType, setSplicingType] = useState<'Direct Drop' | 'Loose Tube'>('Direct Drop');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Target object resolution (either equipment or customer)
  const target = useMemo(() => {
    if (selectedSpliceTarget) return selectedSpliceTarget;
    // Default to first FAT or Splitter
    return (
      equipment.find((e) => e.type === 'FAT' || e.type.includes('Splitter')) ||
      equipment[0] ||
      customers[0]
    );
  }, [selectedSpliceTarget, equipment, customers]);

  const targetCoords: [number, number] = useMemo(() => {
    if (!target) return [16.506, 80.648];
    return [target.lat, target.lng];
  }, [target]);

  // Candidates for upstream parent node (OLTs, Splitters, FATs, Cabinets)
  const upstreamCandidates = useMemo(() => {
    if (!target) return [];
    const targetId = target.id;

    const list: Array<{
      id: string;
      name: string;
      type: string;
      distanceMeters: number;
      ports: Array<{ id: string; name: string }>;
      lat: number;
      lng: number;
    }> = [];

    // 1. OLTs and their PON ports
    equipment
      .filter((e) => e.id !== targetId && (e.type === 'OLT' || e.type === 'MikroTik Router'))
      .forEach((olt) => {
        const dist = Math.round(
          polylineLengthMeters([targetCoords, [olt.lat, olt.lng]]),
        );
        const ports =
          olt.ponPorts?.map((p) => ({ id: p.id, name: p.slotCardPort || p.id })) || [
            { id: 'PON-01', name: 'PON 01 (GPON)' },
            { id: 'PON-02', name: 'PON 02 (GPON)' },
            { id: 'PON-03', name: 'PON 03 (Combo)' },
            { id: 'PON-04', name: 'PON 04 (GPON)' },
          ];
        list.push({
          id: olt.id,
          name: `${olt.name} (${olt.type})`,
          type: 'OLT',
          distanceMeters: dist,
          ports,
          lat: olt.lat,
          lng: olt.lng,
        });
      });

    // 2. Primary & Secondary Splitters
    splitters.forEach((sp) => {
      const hostEq = equipment.find((e) => e.id === sp.terminalBoxId);
      const coords: [number, number] = hostEq ? [hostEq.lat, hostEq.lng] : targetCoords;
      const dist = Math.round(polylineLengthMeters([targetCoords, coords]));
      const ports = sp.outputPorts.map((p) => ({ id: `port-${p.portNumber}`, name: `Out Port ${p.portNumber}` }));
      list.push({
        id: sp.id,
        name: `${sp.name} (${sp.ratio} Splitter)`,
        type: 'Splitter',
        distanceMeters: dist,
        ports: ports.length > 0 ? ports : [
          { id: 'port-1', name: 'Out Port 1' },
          { id: 'port-2', name: 'Out Port 2' },
          { id: 'port-3', name: 'Out Port 3' },
          { id: 'port-4', name: 'Out Port 4' },
        ],
        lat: coords[0],
        lng: coords[1],
      });
    });

    // 3. Distribution Hubs (FDMS / FDT / FAT Enclosures)
    equipment
      .filter(
        (e) =>
          e.id !== targetId &&
          (e.type === 'FDMS' ||
            e.type === 'FDT' ||
            e.type === 'FAT' ||
            e.type === 'Fiber Joint Closure' ||
            e.type === 'Fiber Distribution Cabinet'),
      )
      .forEach((eq) => {
        const dist = Math.round(polylineLengthMeters([targetCoords, [eq.lat, eq.lng]]));
        list.push({
          id: eq.id,
          name: `${eq.name} (${eq.type})`,
          type: eq.type,
          distanceMeters: dist,
          ports: [
            { id: 'port-1', name: 'Drop Tap 1' },
            { id: 'port-2', name: 'Drop Tap 2' },
            { id: 'port-3', name: 'Drop Tap 3' },
          ],
          lat: eq.lat,
          lng: eq.lng,
        });
      });

    // Sort by physical proximity
    return list.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [target, equipment, splitters, targetCoords]);

  // Set initial default upstream candidate
  React.useEffect(() => {
    if (upstreamCandidates[0] && !selectedUpstreamId) {
      setSelectedUpstreamId(upstreamCandidates[0].id);
      setDistanceMeters(Math.max(25, upstreamCandidates[0].distanceMeters));
    }
  }, [upstreamCandidates, selectedUpstreamId]);

  if (!isSpliceModalOpen || !target) return null;

  const currentUpstream = upstreamCandidates.find((c) => c.id === selectedUpstreamId) || upstreamCandidates[0];
  const activeColor = getFiberColor(selectedCoreNumber);

  const handleSelectUpstream = (id: string) => {
    setSelectedUpstreamId(id);
    const candidate = upstreamCandidates.find((c) => c.id === id);
    if (candidate) {
      setDistanceMeters(Math.max(15, candidate.distanceMeters));
      if (candidate.ports[0]) setSelectedPortId(candidate.ports[0].id);
    }
  };

  const handleSaveSplice = () => {
    if (!currentUpstream) {
      showToast('error', 'Selection Missing', 'Please select an upstream parent node.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isCustomerTarget = 'ontSerialNumber' in target;
      const targetName = isCustomerTarget ? (target as Customer).name : (target as Equipment).name;

      // 1. Create connecting physical fiber cable on map
      const cableName = `Link: ${currentUpstream.name} → ${targetName}`;
      const cableCoords: [number, number][] = [
        [currentUpstream.lat, currentUpstream.lng],
        [targetCoords[0], targetCoords[1]],
      ];

      const createdCable = addCable({
        name: cableName,
        type: isCustomerTarget ? 'Drop Fiber' : 'Distribution Fiber',
        startEquipmentId: currentUpstream.id,
        endEquipmentId: target.id,
        coordinates: cableCoords,
        lengthMeters: distanceMeters,
        installationType: 'Aerial',
        routeStatus: 'Active',
      });

      // 2. If target is a subscriber customer/ONU, update logical assignment
      if (isCustomerTarget) {
        updateCustomer(target.id, {
          terminalBoxId: currentUpstream.id,
          dropCableId: createdCable?.id || `DROP-${target.id}`,
          fiberCore: selectedCoreNumber,
          ponPort: selectedPortId,
          splitterId: currentUpstream.id,
        });
      }

      showToast(
        'success',
        'Splice Connection Established',
        `Linked ${targetName} to ${currentUpstream.name} (Core ${selectedCoreNumber} ${activeColor.name}, ${distanceMeters}m).`,
      );

      setModalOpen('spliceModal', false);
    } catch (err: any) {
      showToast('error', 'Splice Failed', err?.message || 'Failed to save optical splice.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCustomer = 'ontSerialNumber' in target;

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Inbound Splicing & Port-Link</h2>
              <p className="text-[11px] text-slate-500">
                Establish optical uplink feeding <span className="font-semibold text-slate-700">{target.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('spliceModal', false)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Target summary banner */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <div>
                <div className="font-bold text-slate-900 text-xs">{target.name}</div>
                <div className="text-[11px] text-slate-500">
                  {isCustomer ? `Subscriber ONT (${(target as Customer).ontSerialNumber})` : (target as Equipment).type} · Coordinates: [{targetCoords[0].toFixed(4)}, {targetCoords[1].toFixed(4)}]
                </div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-purple-100 text-purple-700 font-semibold">
              Downstream Node
            </span>
          </div>

          {/* Upstream Parent Selection */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
              Upstream Parent Node (OLT PON or Splitter Out-Port)
            </label>
            <select
              value={selectedUpstreamId}
              onChange={(e) => handleSelectUpstream(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              {upstreamCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.distanceMeters}m away
                </option>
              ))}
            </select>
            {currentUpstream && (
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
                <Compass className="w-3.5 h-3.5 text-slate-400" />
                <span>Line distance: <strong className="text-slate-700">{currentUpstream.distanceMeters} m</strong></span>
                <span>·</span>
                <span>Type: <strong className="text-slate-700">{currentUpstream.type}</strong></span>
              </div>
            )}
          </div>

          {/* Parent Port and Cable Distance */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                Parent Port Selection
              </label>
              <select
                value={selectedPortId}
                onChange={(e) => setSelectedPortId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium outline-none focus:border-purple-500"
              >
                {currentUpstream?.ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                Cable / Drop Distance (Metres)
              </label>
              <input
                type="number"
                min={5}
                max={5000}
                value={distanceMeters}
                onChange={(e) => setDistanceMeters(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Splicing Type */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
              Splicing & Connection Architecture
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSplicingType('Direct Drop')}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all',
                  splicingType === 'Direct Drop'
                    ? 'border-purple-600 bg-purple-50/60 ring-1 ring-purple-500'
                    : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <div className="font-bold text-slate-900 text-xs">Direct Drop Splicing</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Pre-connectorized or fast field connector drop into terminal
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSplicingType('Loose Tube')}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all',
                  splicingType === 'Loose Tube'
                    ? 'border-purple-600 bg-purple-50/60 ring-1 ring-purple-500'
                    : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <div className="font-bold text-slate-900 text-xs">Loose Tube Fusion Joint</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Multi-fiber core assigned into splice tray sleeve
                </div>
              </button>
            </div>
          </div>

          {/* Core Color Selector: Visual 12-color TIA-598 Standard Palette */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                TIA-598 Standard Fiber Core Palette (12 Colors)
              </label>
              <span className="text-[11px] font-medium text-purple-700">
                Selected: Core {selectedCoreNumber} ({activeColor.name})
              </span>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {STANDARD_12_COLORS.map((col) => {
                const isSelected = selectedCoreNumber === col.number;
                return (
                  <button
                    key={col.number}
                    type="button"
                    onClick={() => setSelectedCoreNumber(col.number)}
                    className={cn(
                      'flex flex-col items-center p-2 rounded-xl border transition-all text-center relative',
                      isSelected
                        ? 'border-purple-600 ring-2 ring-purple-500/40 bg-purple-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <span
                      className="w-5 h-5 rounded-full shadow-xs border border-black/10 flex items-center justify-center text-white"
                      style={{ backgroundColor: col.hex }}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </span>
                    <span className="font-bold text-[11px] text-slate-800 mt-1">#{col.number}</span>
                    <span className="text-[9px] text-slate-500 truncate w-full">{col.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optical Loss Projection Card */}
          <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <div>
                <span className="font-bold text-slate-900 text-xs">Estimated Joint Attenuation:</span>
                <span className="text-[11px] text-slate-600 ml-1.5">
                  ≤ 0.02 dB (Fusion) + {((distanceMeters / 1000) * 0.35).toFixed(2)} dB (Cable run)
                </span>
              </div>
            </div>
            <div className="text-right font-mono font-bold text-purple-800 text-xs">
              Total: ~{(((distanceMeters / 1000) * 0.35) + 0.1).toFixed(2)} dB
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <Button variant="secondary" onClick={() => setModalOpen('spliceModal', false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={PlugZap}
            onClick={handleSaveSplice}
            disabled={isSubmitting}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isSubmitting ? 'Establishing Connection...' : 'Save Splice & Render Path'}
          </Button>
        </div>
      </div>
    </div>
  );
};
