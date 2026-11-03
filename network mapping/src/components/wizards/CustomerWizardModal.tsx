import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  X,
  Users,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Check,
  Router,
  Wifi,
  Sparkles,
  ArrowRight
} from 'lucide-react';

export const CustomerWizardModal: React.FC = () => {
  const {
    isCustomerWizardOpen,
    setIsCustomerWizardOpen,
    equipments,
    splitters,
    cables,
    connectCustomerToPort,
    flyToLocation,
    showToast
  } = useNetwork();

  // Form Fields
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('Koramangala 4th Block');
  const [building, setBuilding] = useState('');
  const [flatNumber, setFlatNumber] = useState('');
  const [lat, setLat] = useState<number>(12.9360);
  const [lng, setLng] = useState<number>(77.6295);

  const [serviceType, setServiceType] = useState<'Fiber Broadband' | 'Triple Play' | 'Enterprise Fiber' | 'Cable TV'>('Fiber Broadband');
  const [plan, setPlan] = useState('FTTH Ultra 300 Mbps');

  // Network connection selections
  const availableTerminals = equipments.filter(e => e.type === 'FAT' || e.type.includes('Terminal Box'));
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(availableTerminals[0]?.id || 'FAT-01');

  // Splitters in chosen terminal
  const terminalSplitters = splitters.filter(s => s.terminalBoxId === selectedTerminalId);
  const [selectedSplitterId, setSelectedSplitterId] = useState<string>(terminalSplitters[0]?.id || 'SP-01');

  // Current splitter and its output ports
  const activeSplitter = splitters.find(s => s.id === selectedSplitterId) || terminalSplitters[0];
  const [selectedPortNumber, setSelectedPortNumber] = useState<number>(() => {
    const firstFree = activeSplitter?.outputPorts.find(p => p.status === 'Available');
    return firstFree ? firstFree.portNumber : 1;
  });

  const [ontSerial, setOntSerial] = useState(`HWTC-ONT-${Date.now().toString().slice(-4)}`);
  const [routerModel, setRouterModel] = useState('Huawei OptiXstar Wi-Fi 6');

  if (!isCustomerWizardOpen) return null;

  const handleTerminalChange = (termId: string) => {
    setSelectedTerminalId(termId);
    const sp = splitters.find(s => s.terminalBoxId === termId);
    if (sp) {
      setSelectedSplitterId(sp.id);
      const freePort = sp.outputPorts.find(p => p.status === 'Available');
      if (freePort) setSelectedPortNumber(freePort.portNumber);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Please enter customer subscriber name.');
      return;
    }

    const connected = connectCustomerToPort({
      name,
      mobile: mobile || '+91 98450 00000',
      address: address || 'Main Road Residence',
      area,
      building: building || undefined,
      flatNumber: flatNumber || undefined,
      lat,
      lng,
      serviceType,
      plan,
      terminalBoxId: selectedTerminalId,
      splitterId: selectedSplitterId,
      splitterOutputPort: selectedPortNumber,
      ontSerialNumber: ontSerial,
      routerModel
    });

    if (connected) {
      flyToLocation(lat, lng, 18);
      setIsCustomerWizardOpen(false);
    }
  };

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
            onClick={() => setIsCustomerWizardOpen(false)}
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
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mobile Contact Phone</label>
                <input
                  type="text"
                  placeholder="+91 98450 12345"
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Service Type</label>
                <select
                  value={serviceType}
                  onChange={e => setServiceType(e.target.value as any)}
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
                  onChange={e => setPlan(e.target.value)}
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
                onChange={e => setAddress(e.target.value)}
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
                  onChange={e => handleTerminalChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
                  {availableTerminals.map(term => (
                    <option key={term.id} value={term.id}>{term.name} ({term.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Splitter Module</label>
                <select
                  value={selectedSplitterId}
                  onChange={e => setSelectedSplitterId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                >
                  {terminalSplitters.map(sp => (
                    <option key={sp.id} value={sp.id}>{sp.name} ({sp.ratio})</option>
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
                  {activeSplitter.outputPorts.map(port => {
                    const isOccupied = port.status === 'Occupied';
                    const isSelected = selectedPortNumber === port.portNumber;
                    return (
                      <button
                        key={port.portNumber}
                        type="button"
                        disabled={isOccupied}
                        onClick={() => setSelectedPortNumber(port.portNumber)}
                        title={isOccupied ? `Occupied by ${port.connectedCustomerName}` : `Port ${port.portNumber}: Free`}
                        className={`p-2 rounded-lg text-center font-bold text-xs transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-400'
                            : isOccupied
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed line-through'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        }`}
                      >
                        {port.portNumber}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 px-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Free Port</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span> Occupied (Blocked)</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600"></span> Selected</span>
                </div>
              </div>
            )}
          </div>

          {/* CPE Hardware */}
          <div className="space-y-3 pt-2">
            <div className="font-bold text-xs text-slate-800 border-b pb-1">3. Customer Premise Equipment (CPE)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">ONT Serial Number</label>
                <input
                  type="text"
                  value={ontSerial}
                  onChange={e => setOntSerial(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Wi-Fi Router Model</label>
                <input
                  type="text"
                  value={routerModel}
                  onChange={e => setRouterModel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              Assigned to Port <span className="font-bold text-slate-800">{selectedPortNumber}</span> on {selectedTerminalId}
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 transition-all"
            >
              <Check className="w-4 h-4" /> Activate Subscriber
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
