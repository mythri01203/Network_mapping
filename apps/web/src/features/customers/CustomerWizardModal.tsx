import React, { useEffect, useMemo, useState } from 'react';
import { Check, LocateFixed, MapPin, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  budgetStatusFor,
  type Customer,
  estimateRxForSplitter,
  hasRecordedLocation,
  isCustomerTerminal,
  linkedUpstreamOfSplitter,
  polylineLengthMeters,
  SPLITTER_RATIOS,
  type SplitterRatio,
} from '@fibergis/shared';

import { currentGpsPosition, gpsFailureMessage } from '../../lib/browser';
import { requestConfirm } from '../../stores/confirmStore';
import { useMapStore } from '../../stores/mapStore';
import { addSplitter, connectCustomerToPort, logAudit } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const CustomerWizardModal: React.FC = () => {
  const { isCustomerWizardOpen, setModalOpen, selectedObject, picking } = useUiStore(
    useShallow((s) => ({
      isCustomerWizardOpen: s.modals.customerWizard,
      setModalOpen: s.setModalOpen,
      selectedObject: s.selectedObject,
      picking: s.customerWizardPicking,
    })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const { equipments, splitters, cables, closures, customers, faults } = useNetworkStore(
    useShallow((s) => ({
      equipments: s.equipment,
      splitters: s.splitters,
      cables: s.cables,
      closures: s.closures,
      customers: s.customers,
      faults: s.faults,
    })),
  );
  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);

  // Form Fields
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [building, setBuilding] = useState('');
  const [flatNumber, setFlatNumber] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locationMethod, setLocationMethod] = useState<Customer['locationMethod']>();
  const [locationAccuracy, setLocationAccuracy] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);

  const [serviceType, setServiceType] = useState<'Fiber Broadband' | 'Triple Play' | 'Enterprise Fiber' | 'Cable TV'>(
    'Fiber Broadband',
  );
  const [plan, setPlan] = useState('');

  // A terminal without a splitter is still listed: its splitter can be added right here.
  const availableTerminals = useMemo(() => equipments.filter((e) => isCustomerTerminal(e.type)), [equipments]);
  // A new splitter's ratio is what is installed in the box: the person chooses it, nothing is assumed.
  const [newSplitterRatio, setNewSplitterRatio] = useState<SplitterRatio | ''>('');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');
  const [selectedSplitterId, setSelectedSplitterId] = useState<string>('');
  const [selectedPortNumber, setSelectedPortNumber] = useState<number | null>(null);
  // Which fiber of the new 2-fiber drop carries the service. Empty until the person chooses.
  const [dropFiber, setDropFiber] = useState<'' | '1' | '2'>('');

  const [ontSerial, setOntSerial] = useState('');
  const [routerModel, setRouterModel] = useState('');

  const selectedTerminal = equipments.find((e) => e.id === selectedTerminalId);
  const terminalSplitters = splitters.filter((s) => s.terminalBoxId === selectedTerminalId);
  const activeSplitter = terminalSplitters.find((s) => s.id === selectedSplitterId);

  // Choosing a box chooses nothing else: the person picks the splitter and the output port.
  const selectTerminal = (termId: string) => {
    setSelectedTerminalId(termId);
    const term = equipments.find((e) => e.id === termId);
    setSelectedSplitterId('');
    setSelectedPortNumber(null);
    setNewSplitterRatio('');
    // The house is not next to the box by default: its position is left for the person to record.
    if (term) setArea(term.area || '');
  };

  const setLocation = (next: { lat: number; lng: number }, method: Customer['locationMethod'], accuracy?: number) => {
    setLat(next.lat.toFixed(6));
    setLng(next.lng.toFixed(6));
    setLocationMethod(method);
    setLocationAccuracy(accuracy);
  };

  const captureGps = async () => {
    setLocating(true);
    try {
      const fix = await currentGpsPosition();
      setLocation(fix, 'gps', fix.accuracyMeters);
      if (fix.accuracyMeters > 20) {
        showToast('warning', 'GPS is rough', `Within about ${Math.round(fix.accuracyMeters)} m. Move to open sky and try again, or pick on the map.`);
      }
    } catch (error) {
      showToast('warning', 'No GPS position', gpsFailureMessage(error));
    } finally {
      setLocating(false);
    }
  };

  // Back from "Pick on map": take the tapped point when it arrives.
  useEffect(
    () =>
      useUiStore.subscribe((state) => {
        const tapped = state.customerWizardPick;
        if (!tapped) return;
        setLat(tapped.lat.toFixed(6));
        setLng(tapped.lng.toFixed(6));
        setLocationMethod('map_pick');
        setLocationAccuracy(undefined);
        state.setCustomerWizardPick(null);
      }),
    [],
  );

  // Re-initialise the form each time the wizard opens (prefer the FAT selected on the map).
  useEffect(() => {
    if (!isCustomerWizardOpen) return;
    setName('');
    setMobile('');
    setAddress('');
    setBuilding('');
    setFlatNumber('');
    setOntSerial('');
    setRouterModel('');
    setPlan('');
    setLat('');
    setLng('');
    setLocationMethod(undefined);
    setLocationAccuracy(undefined);
    setDropFiber('');
    // Only the box the person opened this from on the map. Never the first box or the first with a free port.
    const selectedId = selectedObject?.type === 'equipment' ? selectedObject.data?.id : undefined;
    const preferred = availableTerminals.find((t) => t.id === selectedId);
    if (preferred) selectTerminal(preferred.id);
    else {
      setSelectedTerminalId('');
      setSelectedSplitterId('');
      setSelectedPortNumber(null);
      setNewSplitterRatio('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustomerWizardOpen]);

  const estimate = useMemo(() => {
    if (!selectedTerminal || !activeSplitter) return null;
    const custLat = parseFloat(lat);
    const custLng = parseFloat(lng);
    // No position, no drop length: the estimate then leaves the drop out and says so.
    const dropLen =
      Number.isFinite(custLat) && Number.isFinite(custLng)
        ? Math.round(
            polylineLengthMeters([
              [selectedTerminal.lat, selectedTerminal.lng],
              [custLat, custLng],
            ]),
          )
        : 0;
    return estimateRxForSplitter(
      selectedTerminal,
      activeSplitter,
      { equipment: equipments, cables, splitters, closures, customers, faults },
      dropLen,
      optical,
    );
  }, [selectedTerminal, activeSplitter, lat, lng, equipments, cables, splitters, closures, customers, faults, optical]);

  /*
   * Phase 12: the path the fibre links give, shown step by step before saving. OLT first, then each
   * cable, the box and output, the new drop fiber, the house. Anything the links do not give is
   * "Not recorded"; nothing is filled from a cable that only ends near the box.
   */
  const tracedPath = (() => {
    if (!isCustomerWizardOpen || !activeSplitter) return null;
    const up = linkedUpstreamOfSplitter({ equipment: equipments, cables, splitters, closures, customers }, activeSplitter.id);
    if (!up) return null;
    const olt = up.oltId ? equipments.find((e) => e.id === up.oltId) : undefined;
    const steps: { key: string; label: string; detail: string; missing?: boolean }[] = [
      up.oltId
        ? { key: 'olt', label: 'OLT', detail: `${olt?.name ?? up.oltId}${up.ponPortId ? `, port ${up.ponPortId}` : ', port not recorded'}` }
        : { key: 'olt', label: 'OLT', detail: 'Not recorded', missing: true },
      ...(up.oltId ? [] : [{ key: 'gap', label: 'Links stop', detail: up.gap ?? 'The fibre links do not reach an OLT.', missing: true }]),
      ...up.cablesOltFirst.map((id, i) => ({ key: `cable-${i}`, label: i === up.cablesOltFirst.length - 1 ? 'Into the splitter' : 'Cable', detail: cables.find((c) => c.id === id)?.name ?? id })),
      {
        key: 'splitter',
        label: 'Box and splitter',
        detail: `${selectedTerminal?.name ?? selectedTerminalId}, ${activeSplitter.name}, ${selectedPortNumber !== null ? `output ${selectedPortNumber}` : 'output not chosen yet'}`,
        missing: selectedPortNumber === null,
      },
      { key: 'drop', label: 'New drop', detail: dropFiber ? `Fiber ${dropFiber}` : 'Fiber not chosen yet', missing: !dropFiber },
      { key: 'house', label: 'House', detail: name.trim() || 'New customer' },
    ];
    return { steps, complete: !!up.oltId };
  })();

  // Hidden, not closed, while the person taps the house, so nothing typed is lost.
  if (!isCustomerWizardOpen || picking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Please enter customer subscriber name.');
      return;
    }
    if (!selectedTerminalId || !activeSplitter || selectedPortNumber === null) {
      showToast('error', 'Choose the connection', 'Choose the box, the splitter and a free output port.');
      return;
    }
    if (dropFiber === '') {
      showToast('error', 'Choose the drop fiber', 'Choose which fiber of the new drop carries the service: fiber 1 or fiber 2.');
      return;
    }
    const noLocation = lat.trim() === '' && lng.trim() === '';
    const custLat = parseFloat(lat);
    const custLng = parseFloat(lng);
    const validLocation =
      Number.isFinite(custLat) &&
      Number.isFinite(custLng) &&
      Math.abs(custLat) <= 90 &&
      Math.abs(custLng) <= 180 &&
      hasRecordedLocation({ lat: custLat, lng: custLng });
    if (!noLocation && !validLocation) {
      showToast('error', 'Location not valid', 'Use my GPS or pick on the map, or clear both boxes.');
      return;
    }

    // Warn, do not block: name what the gaps mean and let the person decide.
    const problems = [
      estimate?.level !== 'core' &&
        `The fiber path from this box to the OLT is not recorded${estimate?.gaps[0] ? ` (missing: ${estimate.gaps[0]})` : ''}. The customer will be saved without OLT, PON port and Rx, and cannot be traced until that link is recorded.`,
      noLocation && 'The house location is not recorded, so the drop cable will have no route or length.',
    ].filter(Boolean) as string[];
    if (problems.length > 0) {
      const accepted = await requestConfirm({
        title: 'Save with missing details?',
        message: problems.join('\n\n'),
        confirmLabel: 'Save anyway',
        cancelLabel: 'Go back',
      });
      if (!accepted) return;
    }

    const connected = connectCustomerToPort({
      name: name.trim(),
      mobile: mobile.trim(),
      address: address.trim(),
      area: area.trim() || selectedTerminal?.area,
      building: building.trim() || undefined,
      flatNumber: flatNumber.trim() || undefined,
      ...(validLocation ? { lat: custLat, lng: custLng, locationMethod: locationMethod ?? 'typed', locationAccuracyMeters: locationAccuracy } : {}),
      serviceType,
      plan,
      terminalBoxId: selectedTerminalId,
      splitterId: activeSplitter.id,
      splitterOutputPort: selectedPortNumber,
      fiberCore: Number(dropFiber),
      ontSerialNumber: ontSerial.trim(),
      routerModel,
    });

    if (connected) {
      if (problems.length > 0) {
        logAudit('CUSTOMER_SAVED_WITH_WARNING', `Saved ${connected.id} after a warning: ${problems.join(' ')}`, connected.id, 'Customer');
      }
      if (hasRecordedLocation(connected)) flyToLocation(connected.lat, connected.lng, 18);
      setModalOpen('customerWizard', false);
    }
  };

  const rxStatus = budgetStatusFor(estimate?.rxDbm, optical);
  const hasLocation = lat.trim() !== '' && lng.trim() !== '';

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Connect New Customer Subscriber</h2>
              <p className="text-[11px] text-slate-500">Choose the box and port, then where the house is</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setModalOpen('customerWizard', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* Customer Details */}
          <div className="space-y-3">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">1. Customer Information</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Subscriber Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Chandra"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mobile Contact Phone</label>
                <input
                  type="text"
                  placeholder="+91 98450 12345"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Service Type</label>
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
                  <option value="Fiber Broadband">Fiber Broadband</option>
                  <option value="Triple Play">Triple Play (Data + Voice + TV)</option>
                  <option value="Enterprise Fiber">Enterprise Dedicated (DIA)</option>
                  <option value="Cable TV">Cable TV</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Plan</label>
                <input
                  type="text"
                  placeholder="Not recorded"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Installation Address</label>
              <input
                type="text"
                placeholder="Apartment #, Building, Street"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Network Terminal Selection */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">2. Physical Terminal & Splitter Port</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Access Terminal (FAT)</label>
                <select
                  value={selectedTerminalId}
                  onChange={(e) => selectTerminal(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
                  <option value="">
                    {availableTerminals.length === 0 ? 'Place a terminal box on the map first' : 'Choose the box'}
                  </option>
                  {availableTerminals.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name} ({term.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Splitter Module</label>
                <select
                  value={selectedSplitterId}
                  onChange={(e) => {
                    setSelectedSplitterId(e.target.value);
                    // The person taps the output port below; none is picked for them.
                    setSelectedPortNumber(null);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
                  <option value="">
                    {!selectedTerminal ? 'Choose the box first' : terminalSplitters.length === 0 ? 'No splitter in this box yet' : 'Choose the splitter'}
                  </option>
                  {terminalSplitters.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.ratio})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedTerminal && terminalSplitters.length === 0 && (
              <div className="flex items-end gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex-1">
                  <div className="block text-[11px] font-semibold text-amber-900 mb-1" id="new-splitter-ratio">
                    {selectedTerminal.id} has no splitter yet. Which splitter is in the box? Read the label on it.
                  </div>
                  <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="new-splitter-ratio">
                    {SPLITTER_RATIOS.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        role="radio"
                        aria-checked={newSplitterRatio === ratio}
                        onClick={() => setNewSplitterRatio(ratio)}
                        className={`min-h-10 rounded-lg border text-sm font-bold ${
                          newSplitterRatio === ratio
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-amber-200 bg-white text-slate-800 hover:bg-amber-100'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                  {!newSplitterRatio && <p className="mt-1 text-[11px] text-amber-900">Ratio not chosen yet.</p>}
                </div>
                <button
                  type="button"
                  disabled={!newSplitterRatio}
                  onClick={() => {
                    if (!newSplitterRatio) return;
                    const created = addSplitter({ terminalBoxId: selectedTerminal.id, ratio: newSplitterRatio });
                    if (created) {
                      setSelectedSplitterId(created.id);
                      setSelectedPortNumber(null);
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold"
                >
                  Add splitter
                </button>
              </div>
            )}

            {/* Visual Output Port Selector */}
            {activeSplitter && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Select Available Output Port ({activeSplitter.ratio}):
                </label>
                <div className="grid grid-cols-8 gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {activeSplitter.outputPorts.map((port) => {
                    const isOccupied = port.status === 'Occupied';
                    const isFaulty = port.status === 'Faulty';
                    const isReserved = port.status === 'Reserved';
                    const isBlocked = isOccupied || isFaulty;
                    const isSelected = selectedPortNumber === port.portNumber;
                    return (
                      <button
                        key={port.portNumber}
                        type="button"
                        disabled={isBlocked}
                        onClick={() => setSelectedPortNumber(port.portNumber)}
                        title={
                          isOccupied
                            ? `Occupied by ${port.connectedCustomerName || port.connectedCustomerId}`
                            : isFaulty
                              ? `Port ${port.portNumber}: Faulty`
                              : isReserved
                                ? `Port ${port.portNumber}: Reserved`
                                : `Port ${port.portNumber}: Free`
                        }
                        className={`p-2 rounded-lg text-center font-bold text-xs transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-400'
                            : isFaulty
                              ? 'bg-red-100 text-red-400 cursor-not-allowed line-through'
                              : isOccupied
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed line-through'
                                : isReserved
                                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        }`}
                      >
                        {port.portNumber}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 px-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Free Port
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span> Reserved
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-300"></span> Occupied
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-300"></span> Faulty
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span> Selected
                  </span>
                </div>
                {/* The new drop has 2 fibers. Which one carries the service is the person's choice, never assumed. */}
                <div className="mt-3">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Fiber in the new drop that carries the service:</label>
                  <div className="flex gap-2" role="group" aria-label="Drop fiber">
                    {(['1', '2'] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        data-testid={`drop-fiber-${n}`}
                        aria-pressed={dropFiber === n}
                        onClick={() => setDropFiber(n)}
                        className={`min-h-12 flex-1 rounded-lg border text-xs font-bold ${dropFiber === n ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                      >
                        Fiber {n}
                      </button>
                    ))}
                  </div>
                  {dropFiber === '' && <p className="mt-1 text-[10px] text-slate-500">Choose the fiber the installer connects. The other stays spare.</p>}
                </div>
              </div>
            )}
            {estimate && (
              <div
                className={`rounded-xl border px-3 py-2 text-[11px] ${
                  rxStatus === 'Fail'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : rxStatus === 'Warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : rxStatus === 'Pass'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <div className="font-bold">Path from the fibre links (check before saving)</div>
                {tracedPath && (
                  <ol className="my-1 space-y-0.5" data-testid="traced-path">
                    {tracedPath.steps.map((step, i) => (
                      <li key={step.key} className={`flex gap-2 ${step.missing ? 'font-semibold text-amber-800' : ''}`}>
                        <span className="w-5 shrink-0 text-right font-mono">{i + 1}.</span>
                        <span className="w-28 shrink-0 font-semibold">{step.label}</span>
                        <span className="min-w-0 break-words">{step.detail}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {estimate.level === 'core' ? (
                  <div>Fibers recorded end to end.</div>
                ) : (
                  <div className="font-semibold">
                    Not complete: the fibers from this splitter to the OLT are not recorded.
                    {estimate.gaps[0] && <span className="block font-normal">Missing: {estimate.gaps[0]}</span>}
                  </div>
                )}
                <div>
                  Estimated Rx:{' '}
                  <span className="font-mono font-bold">
                    {estimate.level !== 'core'
                      ? 'Not known: path not complete'
                      : estimate.rxDbm !== undefined
                        ? `${estimate.rxDbm} dBm`
                        : estimate.rxRangeDbm
                          ? `${estimate.rxRangeDbm.min} to ${estimate.rxRangeDbm.max} dBm`
                          : 'Not known'}
                  </span>
                  {estimate.rxDbm !== undefined
                    ? ` (${rxStatus})`
                    : estimate.rxRangeDbm
                      ? ' (launch power not recorded, so a range)'
                      : ''}
                  {!hasLocation && ' · drop not counted until the house is placed'}
                </div>
              </div>
            )}
          </div>

          {/* Installation Location */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">3. Where the house is</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void captureGps()}
                disabled={locating}
                className="flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                <LocateFixed className="h-4 w-4" /> {locating ? 'Getting GPS…' : 'Use my GPS'}
              </button>
              <button
                type="button"
                onClick={() => useUiStore.getState().setCustomerWizardPicking(true)}
                className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <MapPin className="h-4 w-4" /> Pick on map
              </button>
            </div>
            <p className={`text-[11px] ${hasLocation ? 'text-slate-500' : 'font-semibold text-amber-800'}`}>
              {hasLocation
                ? locationMethod === 'gps'
                  ? `From GPS${locationAccuracy !== undefined ? `, within about ${Math.round(locationAccuracy)} m` : ''}.`
                  : locationMethod === 'map_pick'
                    ? 'Picked on the map.'
                    : 'Typed in.'
                : 'Not recorded yet. Stand at the house and tap Use my GPS, or pick the house on the map. Nothing is filled in for you.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Latitude</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lat}
                  placeholder="Not recorded"
                  onChange={(e) => {
                    setLat(e.target.value);
                    setLocationMethod('typed');
                    setLocationAccuracy(undefined);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Longitude</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lng}
                  placeholder="Not recorded"
                  onChange={(e) => {
                    setLng(e.target.value);
                    setLocationMethod('typed');
                    setLocationAccuracy(undefined);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono focus:border-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Area</label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Building</label>
                <input
                  type="text"
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Flat / Unit</label>
                <input
                  type="text"
                  value={flatNumber}
                  onChange={(e) => setFlatNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">A drop cable is drawn from the box to this point.</p>
          </div>

          {/* CPE Hardware */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">4. Customer’s ONT and router</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">ONT Serial Number</label>
                <input
                  type="text"
                  placeholder="Not recorded (leave blank if unknown)"
                  value={ontSerial}
                  onChange={(e) => setOntSerial(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Wi-Fi Router Model</label>
                <input
                  type="text"
                  placeholder="Not recorded"
                  value={routerModel}
                  onChange={(e) => setRouterModel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              {selectedPortNumber !== null ? (
                <>
                  Assigned to Port <span className="font-bold text-slate-800">{selectedPortNumber}</span> on{' '}
                  {selectedTerminalId}
                </>
              ) : (
                <span className="text-red-600 font-semibold">
                  {!selectedTerminalId
                    ? 'Choose the box'
                    : !activeSplitter
                      ? 'Choose the splitter'
                      : activeSplitter.outputPorts.some((p) => p.status === 'Available' || p.status === 'Reserved')
                        ? 'Tap a free output port'
                        : 'No free port on the selected splitter'}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={selectedPortNumber === null}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 transition-all"
            >
              <Check className="w-4 h-4" /> Activate Subscriber
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
