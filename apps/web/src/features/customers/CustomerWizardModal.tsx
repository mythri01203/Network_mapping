import React, { useEffect, useMemo, useState } from 'react';
import { Check, LocateFixed, MapPin, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  budgetStatusFor,
  type Customer,
  estimateRxForSplitter,
  hasRecordedLocation,
  isCustomerTerminal,
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
  const [newSplitterRatio, setNewSplitterRatio] = useState<SplitterRatio>('1:8');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');
  const [selectedSplitterId, setSelectedSplitterId] = useState<string>('');
  const [selectedPortNumber, setSelectedPortNumber] = useState<number | null>(null);

  const [ontSerial, setOntSerial] = useState('');
  const [routerModel, setRouterModel] = useState('');

  const selectedTerminal = equipments.find((e) => e.id === selectedTerminalId);
  const terminalSplitters = splitters.filter((s) => s.terminalBoxId === selectedTerminalId);
  const activeSplitter = terminalSplitters.find((s) => s.id === selectedSplitterId);

  const firstFreePort = (splitterId: string) =>
    splitters.find((s) => s.id === splitterId)?.outputPorts.find((p) => p.status === 'Available')?.portNumber ?? null;

  const selectTerminal = (termId: string) => {
    setSelectedTerminalId(termId);
    const term = equipments.find((e) => e.id === termId);
    const termSplitters = splitters.filter((s) => s.terminalBoxId === termId);
    const sp = termSplitters.find((s) => s.outputPorts.some((p) => p.status === 'Available')) || termSplitters[0];
    setSelectedSplitterId(sp?.id || '');
    setSelectedPortNumber(sp ? firstFreePort(sp.id) : null);
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
    const selectedId = selectedObject?.type === 'equipment' ? selectedObject.data?.id : undefined;
    const preferred =
      availableTerminals.find((t) => t.id === selectedId) ||
      availableTerminals.find((t) =>
        splitters.some((s) => s.terminalBoxId === t.id && s.outputPorts.some((p) => p.status === 'Available')),
      ) ||
      availableTerminals[0];
    if (preferred) selectTerminal(preferred.id);
    else {
      setSelectedTerminalId('');
      setSelectedSplitterId('');
      setSelectedPortNumber(null);
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

  // Hidden, not closed, while the person taps the house, so nothing typed is lost.
  if (!isCustomerWizardOpen || picking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Please enter customer subscriber name.');
      return;
    }
    if (!selectedTerminalId || !activeSplitter || selectedPortNumber === null) {
      showToast('error', 'Validation Error', 'Select a terminal, splitter and a free output port.');
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
      !estimate?.olt &&
        'No OLT is reachable from this box. The customer will be saved as not linked and cannot be traced until a cable connects the box.',
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
                  {availableTerminals.length === 0 && <option value="">Place a terminal box on the map first</option>}
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
                    setSelectedPortNumber(firstFreePort(e.target.value));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
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
                  <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                    {selectedTerminal.id} has no splitter yet. Choose a split ratio:
                  </label>
                  <select
                    value={newSplitterRatio}
                    onChange={(e) => setNewSplitterRatio(e.target.value as SplitterRatio)}
                    className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg outline-none focus:border-blue-500"
                  >
                    {SPLITTER_RATIOS.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const created = addSplitter({ terminalBoxId: selectedTerminal.id, ratio: newSplitterRatio });
                    if (created) {
                      setSelectedSplitterId(created.id);
                      setSelectedPortNumber(1);
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
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
                <div className="font-bold">Upstream path</div>
                <div>
                  {estimate.olt
                    ? `${estimate.olt.id}${estimate.pon ? ` / ${estimate.pon.id}` : ' / no PON port linked'}`
                    : 'No OLT reachable: this customer will be saved as not linked'}
                  {estimate.hops.length > 0 && ` → ${estimate.hops.map((h) => h.cable.id).join(' → ')}`}
                  {` → ${selectedTerminalId} / ${activeSplitter?.id}`}
                </div>
                <div>
                  Estimated Rx:{' '}
                  <span className="font-mono font-bold">
                    {estimate.rxDbm !== undefined
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
                <span className="text-red-600 font-semibold">No free port on the selected splitter</span>
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
