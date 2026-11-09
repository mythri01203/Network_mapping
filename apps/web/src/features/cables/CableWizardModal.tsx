import React, { useEffect, useState } from 'react';
import { Cable as CableIcon, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Cable, CableType, RouteStatus } from '@fibergis/shared';
import { buildCoresWithCapacity, buildOltPonPorts, cableIdPrefix, defaultFiberCount, newRecordId, polylineLengthMeters } from '@fibergis/shared';

import { requestConfirm } from '../../stores/confirmStore';
import { useMapStore } from '../../stores/mapStore';
import { addCable, logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

/** The person said this cable is on no PON port. Never preselected: '' means "not chosen yet". */
const NO_PON = '__none__';

const CABLE_TYPES: Array<{ type: CableType; label: string; desc: string }> = [
  { type: 'Main Feeder Fiber', label: 'Main Feeder Fiber', desc: 'Leaves the OLT toward the distribution network' },
  { type: 'Distribution Fiber', label: 'Distribution Fiber', desc: 'Runs between cabinets and terminal boxes' },
  { type: 'Drop Fiber', label: 'Drop Fiber (FTTH)', desc: 'Runs from a terminal box to a subscriber' },
  { type: 'Aerial Fiber', label: 'Aerial ADSS Fiber', desc: 'Self-supporting span mounted on poles' },
  { type: 'Underground Fiber', label: 'Underground Duct Fiber', desc: 'Armored trunk inside a duct' },
  { type: 'Coaxial Cable', label: 'Coaxial Cable (CATV)', desc: 'RG-11 / RG-6 Cable TV line' },
];

const CORE_COUNTS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288];

type Installation = NonNullable<Cable['installationType']> | '';

/** Only a type that says how it is installed decides it; otherwise it stays "Not recorded". */
const installationFor = (type: CableType): Installation =>
  type === 'Aerial Fiber' ? 'Aerial' : type === 'Underground Fiber' ? 'Underground' : '';

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
  const [manufacturer, setManufacturer] = useState('');
  const [installationType, setInstallationType] = useState<Installation>('');
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('Active');
  const [owner, setOwner] = useState('');
  // Where the drawn line touches equipment. Nothing is connected until the person says yes.
  const [proposedStart, setProposedStart] = useState('');
  const [proposedEnd, setProposedEnd] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reservedCores, setReservedCores] = useState(0);
  const [damagedCores, setDamagedCores] = useState(0);

  // Each new cable starts from what was chosen: ends a person picked are set, and ends the line
  // merely touches are only proposed for the person to confirm.
  useEffect(() => {
    if (!isCableWizardOpen) return;
    const { cableDraftDefaults: defaults, cableTypeToDraw, drawingPoints } = useMapStore.getState();
    const allEquipment = useNetworkStore.getState().equipment;
    const equipmentAt = (point?: [number, number]) =>
      point && allEquipment.find((e) => e.lat === point[0] && e.lng === point[1])?.id;

    const start = defaults?.startEquipmentId ?? '';
    const end = defaults?.endEquipmentId ?? '';
    const snappedStart = start ? undefined : equipmentAt(drawingPoints[0]);
    const snappedEnd = equipmentAt(drawingPoints[drawingPoints.length - 1]);
    setProposedStart(snappedStart ?? '');
    setProposedEnd(!end && snappedEnd && snappedEnd !== (start || snappedStart) ? snappedEnd : '');
    setManufacturer('');
    setOwner('');
    setInstallationType(installationFor(cableTypeToDraw));

    // Phase 9: a random permanent ID, so two offline devices never pick the same one. The name is what people read.
    setCableId(newRecordId(cableIdPrefix(cableTypeToDraw)));
    setCableName('');
    setRemarks('');
    setReservedCores(0);
    setDamagedCores(0);
    setShowDetails(false);
    setCableType(cableTypeToDraw);
    setFiberCount(defaults?.fiberCount ?? defaultFiberCount(cableTypeToDraw));
    setStartEquipmentId(start);
    setEndEquipmentId(end);
    // Only a port the person already picked (for example from the PON port panel). Never the first free one.
    setStartPortName(defaults?.startPortName ?? '');
    setEndPortName(defaults?.endPortName);
    setColorHex(defaults?.colorHex);
  }, [isCableWizardOpen]);

  if (!isCableWizardOpen) return null;

  const startEquipment = equipments.find((e) => e.id === startEquipmentId);
  const endEquipment = equipments.find((e) => e.id === endEquipmentId);
  const ponOptions = startEquipment?.type === 'OLT' ? buildOltPonPorts(startEquipment) : [];
  // The PON port the person picked, if any. "None" and "not chosen yet" both write no port link.
  const chosenPon = startPortName && startPortName !== NO_PON ? startPortName : undefined;

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
  const nameOf = (id: string) => {
    const eq = equipments.find((e) => e.id === id);
    return eq ? `${eq.name} (${eq.id})` : id;
  };
  const hasProposal = !!proposedStart || !!proposedEnd;

  const confirmProposal = () => {
    if (proposedStart) {
      setStartEquipmentId(proposedStart);
      // Confirming the OLT is not choosing its port: the person picks the PON port below.
      setStartPortName('');
    }
    if (proposedEnd) setEndEquipmentId(proposedEnd);
    setProposedStart('');
    setProposedEnd('');
  };

  const handleFinish = async () => {
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

    // Warn, do not block: say what a blank end means and let the person decide.
    const problems = [
      !startEquipmentId && 'The start is not connected to any equipment.',
      !endEquipmentId && 'The end is not connected to any equipment.',
      startEquipmentId && ponOptions.length > 0 && !chosenPon && 'No OLT PON port is chosen.',
    ].filter(Boolean) as string[];
    if (problems.length > 0) {
      const unconfirmed = hasProposal ? '\n\nThe line touches equipment you have not confirmed. Go back and tap "Yes, connect" to use it.' : '';
      const accepted = await requestConfirm({
        title: 'Save a cable that is not connected?',
        message: `${problems.join(' ')}\n\nCustomers on this cable cannot be traced back to the OLT until it is connected.${unconfirmed}`,
        confirmLabel: 'Save without connecting',
        cancelLabel: 'Go back',
      });
      if (!accepted) return;
    }

    const created = addCable({
      id: cableId.trim() || undefined,
      name:
        cableName.trim() ||
        (startEquipmentId && endEquipmentId ? `${startEquipmentId} → ${endEquipmentId}` : 'New Fiber Route'),
      type: cableType,
      manufacturer: manufacturer.trim() || undefined,
      fiberCount,
      cores: buildCoresWithCapacity(fiberCount, reservedCores, damagedCores),
      installationType: installationType || undefined,
      routeStatus,
      owner: owner.trim(),
      remarks: remarks.trim() || undefined,
      startEquipmentId: startEquipmentId || undefined,
      endEquipmentId: endEquipmentId || undefined,
      startPortName: ponOptions.length > 0 ? chosenPon : undefined,
      endPortName,
      colorHex,
      coordinates: coords,
    });

    if (created && problems.length > 0) {
      logAudit('CABLE_SAVED_UNCONNECTED', `Saved ${created.id} after a warning: ${problems.join(' ')}`, created.id, 'Cable');
    }
    if (created) {
      setActiveDrawingPoints([]);
      useMapStore.getState().setCableDraftDefaults(null);
      setModalOpen('cableWizard', false);
    }
  };

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
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
                  setInstallationType(installationFor(type));
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

          {hasProposal && (
            <div role="status" className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-[13px] text-blue-950">
              <p className="font-semibold">Your line touches:</p>
              <ul className="mt-1 list-disc pl-5">
                {proposedStart && <li>Start: {nameOf(proposedStart)}</li>}
                {proposedEnd && <li>End: {nameOf(proposedEnd)}</li>}
              </ul>
              <p className="mt-1">Connect this cable to {proposedStart && proposedEnd ? 'them' : 'it'}?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmProposal}
                  className="min-h-10 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500"
                >
                  Yes, connect
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProposedStart('');
                    setProposedEnd('');
                  }}
                  className="min-h-10 rounded-lg border border-blue-300 bg-white px-4 py-2 text-xs font-semibold text-blue-900"
                >
                  No, leave blank
                </button>
              </div>
            </div>
          )}

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
                    setProposedStart('');
                    setStartPortName('');
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
                    <option value={NO_PON}>None: not on a PON port</option>
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
                onChange={(e) => {
                  setEndEquipmentId(e.target.value);
                  setProposedEnd('');
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
          </div>

          {(!startEquipmentId || !endEquipmentId || (ponOptions.length > 0 && !chosenPon)) && (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              {!startEquipmentId || !endEquipmentId
                ? 'Not connected yet: customers on this cable cannot be traced back to the OLT until both ends are chosen.'
                : startPortName === NO_PON
                  ? 'No PON port: customers on this cable cannot be traced to a port.'
                  : 'Choose the PON port this cable is plugged into (or None), or customers on this cable cannot be traced to a port.'}
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
                      <option value="">Not recorded</option>
                      <option value="Underground">Underground duct</option>
                      <option value="Duct">Duct</option>
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
                      placeholder="Not recorded"
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
                      placeholder="Not recorded"
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
            onClick={() => void handleFinish()}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" /> Save Cable
          </button>
        </div>
      </div>
    </div>
  );
};
