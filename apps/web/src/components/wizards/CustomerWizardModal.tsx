import React, { useEffect, useMemo, useState } from 'react';
import { connectCustomerToPort } from '../../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../../stores/toastStore';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { estimateRxForSplitter, budgetStatusFor } from '@fibergis/shared';
import { X, Users, Check } from 'lucide-react';

const isCustomerTerminalType = (type: string) =>
  type === 'FAT' || type.includes('Terminal Box') || type === 'Distribution Point';

const newOntSerial = () => `HWTC-ONT-${Date.now().toString(36).toUpperCase().slice(-6)}`;

export const CustomerWizardModal: React.FC = () => {
  const { isCustomerWizardOpen, setModalOpen, selectedObject } = useUiStore(
    useShallow((s) => ({
      isCustomerWizardOpen: s.modals.customerWizard,
      setModalOpen: s.setModalOpen,
      selectedObject: s.selectedObject,
    })),
  );
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

  const [serviceType, setServiceType] = useState<'Fiber Broadband' | 'Triple Play' | 'Enterprise Fiber' | 'Cable TV'>(
    'Fiber Broadband',
  );
  const [plan, setPlan] = useState('FTTH Ultra 300 Mbps');

  // Only terminals that actually host a splitter can serve a subscriber.
  const availableTerminals = useMemo(
    () => equipments.filter((e) => isCustomerTerminalType(e.type) && splitters.some((s) => s.terminalBoxId === e.id)),
    [equipments, splitters],
  );
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');
  const [selectedSplitterId, setSelectedSplitterId] = useState<string>('');
  const [selectedPortNumber, setSelectedPortNumber] = useState<number | null>(null);

  const [ontSerial, setOntSerial] = useState(newOntSerial);
  const [routerModel, setRouterModel] = useState('Huawei OptiXstar Wi-Fi 6');

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
    if (term) {
      setLat((term.lat + 0.0003).toFixed(6));
      setLng((term.lng + 0.0003).toFixed(6));
      setArea(term.area || '');
    }
  };

  // Re-initialise the form each time the wizard opens (prefer the FAT selected on the map).
  useEffect(() => {
    if (!isCustomerWizardOpen) return;
    setName('');
    setMobile('');
    setAddress('');
    setBuilding('');
    setFlatNumber('');
    setOntSerial(newOntSerial());
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
    const dropLen =
      Number.isFinite(custLat) && Number.isFinite(custLng)
        ? Math.round(
            Math.hypot(
              (custLat - selectedTerminal.lat) * 111320,
              (custLng - selectedTerminal.lng) * 111320 * Math.cos((custLat * Math.PI) / 180),
            ),
          )
        : 30;
    return estimateRxForSplitter(
      selectedTerminal,
      activeSplitter,
      { equipment: equipments, cables, splitters, closures, customers, faults },
      dropLen,
    );
  }, [selectedTerminal, activeSplitter, lat, lng, equipments, cables, splitters, closures, customers, faults]);

  if (!isCustomerWizardOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Please enter customer subscriber name.');
      return;
    }
    if (!selectedTerminalId || !activeSplitter || selectedPortNumber === null) {
      showToast('error', 'Validation Error', 'Select a terminal, splitter and a free output port.');
      return;
    }
    const custLat = parseFloat(lat);
    const custLng = parseFloat(lng);
    if (!Number.isFinite(custLat) || !Number.isFinite(custLng) || Math.abs(custLat) > 90 || Math.abs(custLng) > 180) {
      showToast('error', 'Invalid Location', 'Enter a valid latitude (-90..90) and longitude (-180..180).');
      return;
    }

    const connected = connectCustomerToPort({
      name: name.trim(),
      mobile: mobile.trim(),
      address: address.trim(),
      area: area.trim() || selectedTerminal?.area,
      building: building.trim() || undefined,
      flatNumber: flatNumber.trim() || undefined,
      lat: custLat,
      lng: custLng,
      serviceType,
      plan,
      terminalBoxId: selectedTerminalId,
      splitterId: activeSplitter.id,
      splitterOutputPort: selectedPortNumber,
      ontSerialNumber: ontSerial.trim(),
      routerModel,
    });

    if (connected) {
      flyToLocation(connected.lat, connected.lng, 18);
      setModalOpen('customerWizard', false);
    }
  };

  const rxStatus = budgetStatusFor(estimate?.rxDbm);

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Connect New Customer Subscriber</h2>
              <p className="text-[11px] text-slate-500">Assign physical terminal port & provision FTTH lead</p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('customerWizard', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
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
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tariff Plan</label>
                <input
                  type="text"
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
                  {availableTerminals.length === 0 && <option value="">No terminal with a splitter</option>}
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
                    ? `${estimate.olt.id}${estimate.pon ? ` / ${estimate.pon.id}` : ''}`
                    : 'No OLT reachable'}
                  {estimate.hops.length > 0 && ` ? ${estimate.hops.map((h) => h.cable.id).join(' ? ')}`}
                  {` ? ${selectedTerminalId} / ${activeSplitter?.id}`}
                </div>
                <div>
                  Estimated Rx:{' '}
                  <span className="font-mono font-bold">
                    {estimate.rxDbm !== undefined ? `${estimate.rxDbm} dBm` : 'n/a'}
                  </span>{' '}
                  ({rxStatus})
                </div>
              </div>
            )}
          </div>

          {/* Installation Location */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">3. Premises Location</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Latitude</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Longitude</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
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
            <p className="text-[10px] text-slate-500">
              Defaults next to the selected terminal; a drop cable is drawn from the terminal to this point.
            </p>
          </div>

          {/* CPE Hardware */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">4. Customer Premise Equipment (CPE)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">ONT Serial Number</label>
                <input
                  type="text"
                  value={ontSerial}
                  onChange={(e) => setOntSerial(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Wi-Fi Router Model</label>
                <input
                  type="text"
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
