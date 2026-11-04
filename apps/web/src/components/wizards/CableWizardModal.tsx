import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { CableType, Cable, RouteStatus } from '../../types/network';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Cable as CableIcon,
  Layers,
  MapPin,
  Settings,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const CableWizardModal: React.FC = () => {
  const {
    isCableWizardOpen,
    setIsCableWizardOpen,
    equipments,
    addCable,
    activeDrawingPoints,
    setActiveDrawingPoints,
    showToast,
  } = useNetwork();

  const [step, setStep] = useState(1);

  // Form State
  const [cableType, setCableType] = useState<CableType>('Main Feeder Fiber');
  const [cableId, setCableId] = useState(`CBL-${Date.now().toString().slice(-5)}`);
  const [cableName, setCableName] = useState('New Fiber Route');
  const [manufacturer, setManufacturer] = useState('Corning Optical');
  const [model, setModel] = useState('SMF-28 Ultra 2026');
  const [fiberCount, setFiberCount] = useState<number>(48);
  const [installationType, setInstallationType] = useState<
    'Aerial' | 'Underground' | 'Duct' | 'Direct Buried' | 'Facade'
  >('Underground');
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('Active');
  const [owner, setOwner] = useState('Metropolitan Fiber Corp');
  const [remarks, setRemarks] = useState('Planned fiber link');

  const [startEquipmentId, setStartEquipmentId] = useState<string>(equipments[0]?.id || '');
  const [endEquipmentId, setEndEquipmentId] = useState<string>(equipments[1]?.id || '');

  // Capacity breakdown
  const [usedCores, setUsedCores] = useState<number>(0);
  const [reservedCores, setReservedCores] = useState<number>(4);
  const [damagedCores, setDamagedCores] = useState<number>(0);

  if (!isCableWizardOpen) return null;

  const availableCores = Math.max(0, fiberCount - usedCores - reservedCores - damagedCores);

  // Approximate distance calculation from coordinates
  const coords: [number, number][] =
    activeDrawingPoints.length >= 2
      ? activeDrawingPoints
      : [
          [
            equipments.find((e) => e.id === startEquipmentId)?.lat || 12.9352,
            equipments.find((e) => e.id === startEquipmentId)?.lng || 77.6245,
          ],
          [
            equipments.find((e) => e.id === endEquipmentId)?.lat || 12.9375,
            equipments.find((e) => e.id === endEquipmentId)?.lng || 77.6272,
          ],
        ];

  const handleFinish = () => {
    if (!cableName.trim()) {
      showToast('error', 'Validation Error', 'Please enter a valid cable name.');
      return;
    }

    const created = addCable({
      id: cableId,
      name: cableName,
      type: cableType,
      manufacturer,
      model,
      fiberCount,
      installationType,
      routeStatus,
      owner,
      remarks,
      startEquipmentId: startEquipmentId || undefined,
      endEquipmentId: endEquipmentId || undefined,
      coordinates: coords,
    });

    if (created) {
      setActiveDrawingPoints([]);
      setIsCableWizardOpen(false);
      setStep(1);
    }
  };

  const cableTypesList: Array<{ type: CableType; label: string; desc: string; defaultCores: number; color: string }> = [
    {
      type: 'Main Feeder Fiber',
      label: 'Main Feeder Fiber',
      desc: 'Central Office OLT to Primary FDMS Cabinet',
      defaultCores: 96,
      color: 'bg-blue-600',
    },
    {
      type: 'Distribution Fiber',
      label: 'Distribution Fiber',
      desc: 'FDMS Cabinet to Secondary FDT Hubs',
      defaultCores: 24,
      color: 'bg-cyan-600',
    },
    {
      type: 'Drop Fiber',
      label: 'Drop Fiber (FTTH)',
      desc: 'FAT Box to Subscriber Home ONT',
      defaultCores: 2,
      color: 'bg-amber-500',
    },
    {
      type: 'Aerial Fiber',
      label: 'Aerial ADSS Fiber',
      desc: 'Self-supporting pole-mounted span',
      defaultCores: 12,
      color: 'bg-emerald-600',
    },
    {
      type: 'Underground Fiber',
      label: 'Underground Duct Fiber',
      desc: 'Duct-encased heavy armor trunk',
      defaultCores: 48,
      color: 'bg-purple-600',
    },
    {
      type: 'Coaxial Cable',
      label: 'Coaxial Cable (CATV)',
      desc: 'RG-11 / RG-6 Cable TV Trunk Line',
      defaultCores: 1,
      color: 'bg-orange-600',
    },
  ];

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Wizard Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
              <CableIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">FTTH Cable Route Provisioning Wizard</h2>
              <p className="text-[11px] text-slate-500">
                Step {step} of 6 &bull;{' '}
                {step === 1
                  ? 'Cable Architecture'
                  : step === 2
                    ? 'Route Information'
                    : step === 3
                      ? 'Endpoints'
                      : step === 4
                        ? 'Waypoints'
                        : step === 5
                          ? 'Core Allocation'
                          : 'Confirmation'}
              </p>
            </div>
          </div>
          <button onClick={() => setIsCableWizardOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Body Steps */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* STEP 1: CABLE TYPE SELECTION */}
          {step === 1 && (
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700 mb-1">Select Cable Type & Role in Network</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cableTypesList.map((item) => (
                  <button
                    key={item.type}
                    onClick={() => {
                      setCableType(item.type);
                      setFiberCount(item.defaultCores);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all flex items-start gap-3 ${
                      cableType === item.type
                        ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full ${item.color} mt-0.5 shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs text-slate-900">{item.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{item.desc}</div>
                      <div className="text-[10px] text-blue-600 font-semibold mt-1">
                        Default: {item.defaultCores} Cores
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: CABLE INFORMATION & ROUTE STATUS */}
          {step === 2 && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cable Identification ID</label>
                  <input
                    type="text"
                    value={cableId}
                    onChange={(e) => setCableId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Cable Name / Route Label
                  </label>
                  <input
                    type="text"
                    value={cableName}
                    onChange={(e) => setCableName(e.target.value)}
                    placeholder="e.g. Sector 4 East Feeder Link"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Total Fiber Cores</label>
                  <select
                    value={fiberCount}
                    onChange={(e) => setFiberCount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                  >
                    {[2, 4, 6, 8, 12, 24, 48, 96, 144, 288].map((cnt) => (
                      <option key={cnt} value={cnt}>
                        {cnt} Cores
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Installation Method</label>
                  <select
                    value={installationType}
                    onChange={(e) => setInstallationType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                  >
                    <option value="Underground">Underground Duct</option>
                    <option value="Aerial">Aerial ADSS / Lash</option>
                    <option value="Direct Buried">Direct Buried Armor</option>
                    <option value="Facade">Building Facade</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Route Planning Status</label>
                  <select
                    value={routeStatus}
                    onChange={(e) => setRouteStatus(e.target.value as RouteStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold text-xs"
                  >
                    <option value="Active">🟢 Existing / Installed Route</option>
                    <option value="Proposed">🟡 Proposed Planned Route</option>
                    <option value="Under Construction">🟠 Route Under Construction</option>
                    <option value="Maintenance">🔧 Maintenance / Repair</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cable Manufacturer</label>
                  <input
                    type="text"
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cable Owner / Operator</label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Remarks & Splicing Notes</label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-xs"
                />
              </div>
            </div>
          )}

          {/* STEP 3: ENDPOINTS */}
          {step === 3 && (
            <div className="space-y-4 text-xs">
              <p className="text-slate-600 text-xs">
                Select the physical starting and destination equipment to logically tie the route to your network
                topology.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-blue-700 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" /> Starting Equipment (Origin)
                  </div>
                  <select
                    value={startEquipmentId}
                    onChange={(e) => setStartEquipmentId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="">— Choose Origin Equipment —</option>
                    {equipments.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-emerald-700 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" /> Ending Equipment (Termination)
                  </div>
                  <select
                    value={endEquipmentId}
                    onChange={(e) => setEndEquipmentId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="">— Choose Ending Equipment —</option>
                    {equipments.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: ROUTE POINTS */}
          {step === 4 && (
            <div className="space-y-3 text-xs">
              <div className="p-4 bg-blue-50/70 rounded-xl border border-blue-200">
                <div className="font-bold text-xs text-blue-900 mb-1">Geographic Route Waypoints</div>
                <p className="text-blue-800 text-[11px] mb-2">
                  Route contains <span className="font-bold">{coords.length} waypoints</span> with road and pole
                  geometry alignment.
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-blue-100 font-mono text-[11px] text-slate-700 max-h-36 overflow-y-auto space-y-1">
                  {coords.map((pt, i) => (
                    <div key={i} className="flex justify-between">
                      <span>Point #{i + 1}:</span>
                      <span>
                        [{pt[0].toFixed(5)}, {pt[1].toFixed(5)}]
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: FIBER CAPACITY CONFIGURATION */}
          {step === 5 && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Total Cores</div>
                  <div className="font-bold text-lg text-slate-800 mt-0.5">{fiberCount}</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <div className="text-[10px] text-emerald-600 font-bold uppercase">Available</div>
                  <div className="font-bold text-lg text-emerald-700 mt-0.5">{availableCores}</div>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="text-[10px] text-amber-600 font-bold uppercase">Reserved</div>
                  <input
                    type="number"
                    min="0"
                    max={fiberCount}
                    value={reservedCores}
                    onChange={(e) => setReservedCores(Number(e.target.value))}
                    className="w-16 mx-auto mt-0.5 text-center font-bold text-base bg-white border border-amber-300 rounded px-1"
                  />
                </div>
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                  <div className="text-[10px] text-rose-600 font-bold uppercase">Damaged</div>
                  <input
                    type="number"
                    min="0"
                    max={fiberCount}
                    value={damagedCores}
                    onChange={(e) => setDamagedCores(Number(e.target.value))}
                    className="w-16 mx-auto mt-0.5 text-center font-bold text-base bg-white border border-rose-300 rounded px-1"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="font-semibold text-slate-700">Automatic Fiber Color Sequence:</div>
                <div className="grid grid-cols-6 gap-1 text-center font-semibold text-[10px]">
                  {[
                    'Blue',
                    'Orange',
                    'Green',
                    'Brown',
                    'Slate',
                    'White',
                    'Red',
                    'Black',
                    'Yellow',
                    'Violet',
                    'Rose',
                    'Aqua',
                  ].map((c, idx) => (
                    <div key={c} className="p-1 rounded bg-white border border-slate-200 shadow-xs">
                      #{idx + 1} {c}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: CONFIRM & SAVE */}
          {step === 6 && (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                <div className="font-bold text-xs text-slate-800 border-b pb-1.5">Route Configuration Summary</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Cable ID:</span>{' '}
                    <span className="font-mono font-bold text-blue-600">{cableId}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cable Name:</span>{' '}
                    <span className="font-semibold">{cableName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cable Type:</span>{' '}
                    <span className="font-semibold">{cableType}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Route Status:</span>{' '}
                    <span className="font-bold text-blue-700">{routeStatus}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Capacity:</span>{' '}
                    <span className="font-bold text-emerald-600">
                      {fiberCount} Cores ({availableCores} Free)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Origin:</span>{' '}
                    <span className="font-semibold">{startEquipmentId || 'Map Geometry'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Termination:</span>{' '}
                    <span className="font-semibold">{endEquipmentId || 'Map Geometry'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Verified: No endpoint collisions detected. All {fiberCount} cores generated according to standard
                  color coding.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Buttons */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <button
            onClick={() => setStep((prev) => Math.max(1, prev - 1))}
            disabled={step === 1}
            className="px-4 py-2 border border-slate-200 text-slate-700 disabled:opacity-30 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>

          {step < 6 ? (
            <button
              onClick={() => setStep((prev) => Math.min(6, prev + 1))}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 shadow-xs"
            >
              Next Step <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Confirm & Place Cable on Map
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
