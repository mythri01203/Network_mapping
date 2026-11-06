import React, { useEffect, useState } from 'react';
import { Cable as CableIcon, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Cable, CableType, Equipment, RouteStatus } from '@fibergis/shared';
import { buildCoresWithCapacity, buildOltPonPorts, defaultFiberCount, polylineLengthMeters } from '@fibergis/shared';

import { useMapStore } from '../../stores/mapStore';
import { addCable } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

const firstFreePon = (equipment?: Equipment) =>
  equipment?.type === 'OLT' ? (buildOltPonPorts(equipment).find((p) => !p.connectedFeederCableId)?.id ?? '') : '';

const CABLE_TYPES: Array<{ type: CableType; label: string; desc: string }> = [
  { type: 'Main Feeder Fiber', label: 'Main Feeder Fiber', desc: 'Leaves the OLT toward the distribution network' },
  { type: 'Distribution Fiber', label: 'Distribution Fiber', desc: 'Runs between cabinets and terminal boxes' },
  { type: 'Drop Fiber', label: 'Drop Fiber (FTTH)', desc: 'Runs from a terminal box to a subscriber' },
  { type: 'Aerial Fiber', label: 'Aerial ADSS Fiber', desc: 'Self-supporting span mounted on poles' },
  { type: 'Underground Fiber', label: 'Underground Duct Fiber', desc: 'Armored trunk inside a duct' },
  { type: 'Coaxial Cable', label: 'Coaxial Cable (CATV)', desc: 'RG-11 / RG-6 Cable TV line' },
];

const CORE_COUNTS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288];
const MODEL = 'SMF-28 Ultra 2026';

const labelClass = 'block text-[11px] font-semibold text-slate-600 mb-1';
const fieldClass =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white';

export const CableWizardModal: React.FC = () => {
  const { isCableWizardOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isCableWizardOpen: s.modals.cableWizard, setModalOpen: s.setModalOpen })),
  );
  const equipments = useNetworkStore((s) => s.equipment);
  const { activeDrawingPoints, setActiveDrawingPoints } = useMapStore(
    useShallow((s) => ({ activeDrawingPoints: s.drawingPoints, setActiveDrawingPoints: s.setDrawingPoints })),
  );
  const showToast = useToastStore((s) => s.show);

  // What this cable connects
  const [cableType, setCableType] = useState<CableType>('Main Feeder Fiber');
  const [fiberCount, setFiberCount] = useState(48);
  const [startEquipmentId, setStartEquipmentId] = useState('');
  const [startPortName, setStartPortName] = useState('');
  const [endEquipmentId, setEndEquipmentId] = useState('');
  const [endPortName, setEndPortName] = useState<string | undefined>();
  const [colorHex, setColorHex] = useState<string | undefined>();

  // Optional record details
  const [showDetails, setShowDetails] = useState(false);
  const [cableId, setCableId] = useState('');
  const [cableName, setCableName] = useState('');
  const [manufacturer, setManufacturer] = useState('Corning Optical');
  const [installationType, setInstallationType] = useState<NonNullable<Cable['installationType']>>('Underground');
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('Active');
  const [owner, setOwner] = useState('Metropolitan Fiber Corp');
  const [remarks, setRemarks] = useState('');
  const [reservedCores, setReservedCores] = useState(0);
  const [damagedCores, setDamagedCores] = useState(0);

  // Each new cable starts from what was drawn: snapped route ends and any OLT cable settings.
  useEffect(() => {
    if (!isCableWizardOpen) return;
    const { cableDraftDefaults: defaults, cableTypeToDraw, drawingPoints } = useMapStore.getState();
    const allEquipment = useNetworkStore.getState().equipment;
    const equipmentAt = (point?: [number, number]) =>
      point && allEquipment.find((e) => e.lat === point[0] && e.lng === point[1])?.id;

    const start = defaults?.startEquipmentId ?? equipmentAt(drawingPoints[0]) ?? '';
    const snappedEnd = equipmentAt(drawingPoints[drawingPoints.length - 1]);
    const end = (snappedEnd !== start ? snappedEnd : undefined) ?? defaults?.endEquipmentId ?? '';

    setCableId(`CBL-${Date.now().toString().slice(-5)}`);
    setCableName('');
    setRemarks('');
    setReservedCores(0);
    setDamagedCores(0);
    setShowDetails(false);
    setCableType(cableTypeToDraw);
    setFiberCount(defaults?.fiberCount ?? defaultFiberCount(cableTypeToDraw));
    setStartEquipmentId(start);
    setEndEquipmentId(end);
    setStartPortName(defaults?.startPortName ?? firstFreePon(allEquipment.find((e) => e.id === start)));
    setEndPortName(defaults?.endPortName);
    setColorHex(defaults?.colorHex);
  }, [isCableWizardOpen]);

  if (!isCableWizardOpen) return null;

  const startEquipment = equipments.find((e) => e.id === startEquipmentId);
  const endEquipment = equipments.find((e) => e.id === endEquipmentId);
  const ponOptions = startEquipment?.type === 'OLT' ? buildOltPonPorts(startEquipment) : [];

  const coords: [number, number][] =
    activeDrawingPoints.length >= 2
      ? activeDrawingPoints
      : startEquipment && endEquipment
        ? [
            [startEquipment.lat, startEquipment.lng],
            [endEquipment.lat, endEquipment.lng],
          ]
        : [];
  const routeLength = coords.length >= 2 ? Math.round(polylineLengthMeters(coords)) : 0;
  const availableCores = fiberCount - reservedCores - damagedCores;
  const coreCounts = CORE_COUNTS.includes(fiberCount) ? CORE_COUNTS : [fiberCount, ...CORE_COUNTS];
  const typeDescription = CABLE_TYPES.find((t) => t.type === cableType)?.desc;

  const handleFinish = () => {
    if (coords.length < 2) {
      showToast('error', 'Route Missing', 'Draw a route on the map, or choose both start and end equipment.');
      return;
    }
    if (startEquipmentId && startEquipmentId === endEquipmentId) {
      showToast('error', 'Invalid Endpoints', 'A cable must end at different equipment from where it starts.');
      return;
    }
    if (reservedCores < 0 || damagedCores < 0 || availableCores < 0) {
      setShowDetails(true);
      showToast('error', 'Invalid Core Counts', `Reserved and damaged cores cannot exceed ${fiberCount} in total.`);
      return;
    }

    const created = addCable({
      id: cableId.trim() || undefined,
      name:
        cableName.trim() ||
        (startEquipmentId && endEquipmentId ? `${startEquipmentId} → ${endEquipmentId}` : 'New Fiber Route'),
      type: cableType,
      manufacturer,
      model: MODEL,
      fiberCount,
      cores: buildCoresWithCapacity(fiberCount, reservedCores, damagedCores),
      installationType,
      routeStatus,
      owner,
      remarks: remarks.trim() || undefined,
      startEquipmentId: startEquipmentId || undefined,
      endEquipmentId: endEquipmentId || undefined,
      startPortName: ponOptions.length > 0 ? startPortName || undefined : undefined,
      endPortName,
      colorHex,
      coordinates: coords,
    });

    if (created) {
      setActiveDrawingPoints([]);
      useMapStore.getState().setCableDraftDefaults(null);
      setModalOpen('cableWizard', false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
              <CableIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Save Cable</h2>
              <p className="text-[11px] text-slate-500">
                {coords.length >= 2
                  ? `${coords.length} route points · ${routeLength.toLocaleString()} m`
                  : 'Choose where this cable starts and ends'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setModalOpen('cableWizard', false)}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="cable-type" className={labelClass}>
                Cable type
              </label>
              <select
                id="cable-type"
                value={cableType}
                onChange={(e) => {
                  const type = e.target.value as CableType;
                  setCableType(type);
                  setFiberCount(defaultFiberCount(type));
                }}
                className={fieldClass}
              >
                {CABLE_TYPES.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{typeDescription}</p>
            </div>
            <div>
              <label htmlFor="cable-cores" className={labelClass}>
                Total cores
              </label>
              <select
                id="cable-cores"
                value={fiberCount}
                onChange={(e) => setFiberCount(Number(e.target.value))}
                className={fieldClass}
              >
                {coreCounts.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-3">
              <div>
                <label htmlFor="cable-start" className={labelClass}>
                  Starts at
                </label>
                <select
                  id="cable-start"
                  value={startEquipmentId}
                  onChange={(e) => {
                    setStartEquipmentId(e.target.value);
                    setStartPortName(firstFreePon(equipments.find((eq) => eq.id === e.target.value)));
                  }}
                  className={fieldClass}
                >
                  <option value="">Choose equipment</option>
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.id})
                    </option>
                  ))}
                </select>
              </div>
              {ponOptions.length > 0 && (
                <div>
                  <label htmlFor="cable-pon" className={labelClass}>
                    OLT PON port
                  </label>
                  <select
                    id="cable-pon"
                    value={startPortName}
                    onChange={(e) => setStartPortName(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Choose PON port</option>
                    {ponOptions.map((pon) => (
                      <option key={pon.id} value={pon.id} disabled={!!pon.connectedFeederCableId}>
                        {pon.id}
                        {pon.connectedFeederCableId ? ` (feeds ${pon.connectedFeederCableId})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="cable-end" className={labelClass}>
                Ends at
              </label>
              <select
                id="cable-end"
                value={endEquipmentId}
                onChange={(e) => setEndEquipmentId(e.target.value)}
                className={fieldClass}
              >
                <option value="">Choose equipment</option>
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(!startEquipmentId || !endEquipmentId || (ponOptions.length > 0 && !startPortName)) && (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              {!startEquipmentId || !endEquipmentId
                ? 'Choose both ends, or customers on this cable cannot be traced back to the OLT.'
                : 'Choose a PON port, or customers on this cable cannot be traced to a port.'}
            </p>
          )}

          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((open) => !open)}
              className="flex w-full items-center gap-1.5 font-semibold text-slate-700 hover:text-slate-900"
            >
              {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              More details
              <span className="font-normal text-slate-500">(optional)</span>
            </button>

            {showDetails && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cable-name" className={labelClass}>
                      Cable name
                    </label>
                    <input
                      id="cable-name"
                      type="text"
                      value={cableName}
                      onChange={(e) => setCableName(e.target.value)}
                      placeholder="Named after its endpoints if blank"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="cable-id" className={labelClass}>
                      Cable ID
                    </label>
                    <input
                      id="cable-id"
                      type="text"
                      value={cableId}
                      onChange={(e) => setCableId(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cable-reserved" className={labelClass}>
                      Reserved cores
                    </label>
                    <input
                      id="cable-reserved"
                      type="number"
                      min="0"
                      max={fiberCount}
                      value={reservedCores}
                      onChange={(e) => setReservedCores(Math.trunc(Number(e.target.value)))}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="cable-damaged" className={labelClass}>
                      Damaged cores
                    </label>
                    <input
                      id="cable-damaged"
                      type="number"
                      min="0"
                      max={fiberCount}
                      value={damagedCores}
                      onChange={(e) => setDamagedCores(Math.trunc(Number(e.target.value)))}
                      className={fieldClass}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  {Math.max(0, availableCores)} of {fiberCount} cores will be available. Reserved and damaged cores are
                  taken from the highest core numbers.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cable-install" className={labelClass}>
                      Installation method
                    </label>
                    <select
                      id="cable-install"
                      value={installationType}
                      onChange={(e) => setInstallationType(e.target.value as typeof installationType)}
                      className={fieldClass}
                    >
                      <option value="Underground">Underground duct</option>
                      <option value="Aerial">Aerial ADSS / lash</option>
                      <option value="Direct Buried">Direct buried armor</option>
                      <option value="Facade">Building facade</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cable-status" className={labelClass}>
                      Route status
                    </label>
                    <select
                      id="cable-status"
                      value={routeStatus}
                      onChange={(e) => setRouteStatus(e.target.value as RouteStatus)}
                      className={fieldClass}
                    >
                      <option value="Active">Existing / installed</option>
                      <option value="Proposed">Proposed</option>
                      <option value="Under Construction">Under construction</option>
                      <option value="Maintenance">Maintenance / repair</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cable-maker" className={labelClass}>
                      Manufacturer
                    </label>
                    <input
                      id="cable-maker"
                      type="text"
                      value={manufacturer}
                      onChange={(e) => setManufacturer(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="cable-owner" className={labelClass}>
                      Owner / operator
                    </label>
                    <input
                      id="cable-owner"
                      type="text"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="cable-remarks" className={labelClass}>
                    Remarks
                  </label>
                  <textarea
                    id="cable-remarks"
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setModalOpen('cableWizard', false)}
            className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFinish}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" /> Save Cable
          </button>
        </div>
      </div>
    </div>
  );
};
