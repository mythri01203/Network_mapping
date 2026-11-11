import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Cable as CableIcon, Check, PenLine, Plus, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { AttachmentStatus, Cable, CableInstallationType, CableSheath, CableType, FiberMode, FiberStandard, RouteStatus } from '@fibergis/shared';
import {
  buildCoresWithCapacity,
  buildOltPonPorts,
  cableBuildProblem,
  cableIdPrefix,
  defaultFiberCount,
  ductsAlongLine,
  newRecordId,
  polesNearLine,
  polylineLengthMeters,
  tubeRecordsProblem,
  UNKNOWN_SCHEME_ID,
} from '@fibergis/shared';

import { requestConfirm } from '../../stores/confirmStore';
import { useMapStore } from '../../stores/mapStore';
import { logAudit } from '../../stores/networkActions';
import { selectColorSchemes, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { CableBuildFields } from './CableBuildSection';
import { askSameCable, logDifferentCable, saveNewCable } from './cableRouteActions';

/**
 * Phase 5: the cable form as steps, one question at a time: what kind of cable, its fibres and
 * tubes, its two ends, its route, the poles or duct carrying it, slack, and a last check. Every
 * step can be skipped back to; nothing is chosen for the person except a typical fibre count for the
 * kind, shown before saving. The whole cable is saved as one change, so one Undo removes it all.
 */

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

const STEPS = [
  { key: 'type', label: 'Kind' },
  { key: 'cores', label: 'Fibres' },
  { key: 'ends', label: 'Ends' },
  { key: 'route', label: 'Route' },
  { key: 'support', label: 'Poles / duct' },
  { key: 'slack', label: 'Slack' },
  { key: 'check', label: 'Check' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

type Installation = CableInstallationType | undefined;
type TubeMode = 'none' | 'same' | 'mixed';

/** Only a type that says how it is installed decides it; otherwise it stays "Not recorded". */
const installationFor = (type: CableType): Installation =>
  type === 'Aerial Fiber' ? 'Aerial' : type === 'Underground Fiber' ? 'Underground' : undefined;

const labelClass = 'block text-[13px] font-semibold text-slate-700 mb-1';
const fieldClass =
  'w-full min-h-[48px] px-3 py-2 text-[14px] bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white';
const bigButton = 'min-h-[48px] rounded-lg px-4 py-2 text-[14px] font-semibold';

interface SlackRow {
  key: string;
  structureId: string;
  length: string;
}

export const CableWizardModal: React.FC = () => {
  const { isCableWizardOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isCableWizardOpen: s.modals.cableWizard, setModalOpen: s.setModalOpen })),
  );
  const equipments = useNetworkStore((s) => s.equipment);
  const ducts = useNetworkStore((s) => s.ducts);
  const schemes = useNetworkStore(selectColorSchemes);
  const ospSettings = useNetworkStore(selectOspSettings);
  const { activeDrawingPoints, setActiveDrawingPoints } = useMapStore(
    useShallow((s) => ({ activeDrawingPoints: s.drawingPoints, setActiveDrawingPoints: s.setDrawingPoints })),
  );
  const showToast = useToastStore((s) => s.show);

  const [step, setStep] = useState<StepKey>('type');

  // What this cable connects
  const [cableType, setCableType] = useState<CableType>('Main Feeder Fiber');
  const [fiberCount, setFiberCount] = useState(48);
  const [startEquipmentId, setStartEquipmentId] = useState('');
  const [startPortName, setStartPortName] = useState('');
  const [endEquipmentId, setEndEquipmentId] = useState('');
  const [endPortName, setEndPortName] = useState<string | undefined>();
  const [colorHex, setColorHex] = useState<string | undefined>();

  // Record details, all optional
  const [cableId, setCableId] = useState('');
  const [cableName, setCableName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [build, setBuild] = useState<{ fiberStandard?: FiberStandard; fiberMode?: FiberMode; sheath?: CableSheath; outerDiameterMm?: number; installationType?: Installation }>({});
  // Phase 5: "Not recorded" until the person says (it used to start as "Existing / installed").
  const [routeStatus, setRouteStatus] = useState<RouteStatus | ''>('');
  const [owner, setOwner] = useState('');
  // Where the drawn line touches equipment. Nothing is connected until the person says yes.
  const [proposedStart, setProposedStart] = useState('');
  const [proposedEnd, setProposedEnd] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reservedCores, setReservedCores] = useState(0);
  const [damagedCores, setDamagedCores] = useState(0);

  // Fibres and tubes (Phase 7 tube records). Nothing is assumed: colours "not known" until chosen.
  const [colorScheme, setColorScheme] = useState('');
  const [tubeColorScheme, setTubeColorScheme] = useState('');
  const [tubeMode, setTubeMode] = useState<TubeMode>('none');
  const [fibersPerTube, setFibersPerTube] = useState(12);
  const [tubeSizes, setTubeSizes] = useState<string[]>(['12']);
  const [layoutSource, setLayoutSource] = useState('');

  // Poles, duct and slack. None ticked or chosen to start with.
  const [poleIds, setPoleIds] = useState<string[]>([]);
  const [poleStatus, setPoleStatus] = useState<AttachmentStatus | ''>('');
  const [ductChoice, setDuctChoice] = useState('');
  const [slack, setSlack] = useState<SlackRow[]>([]);
  const [saving, setSaving] = useState(false);

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
    setBuild({ installationType: installationFor(cableTypeToDraw) });
    setRouteStatus('');

    // Phase 9: a random permanent ID, so two offline devices never pick the same one. The name is what people read.
    setCableId(newRecordId(cableIdPrefix(cableTypeToDraw)));
    setCableName('');
    setRemarks('');
    setReservedCores(0);
    setDamagedCores(0);
    setCableType(cableTypeToDraw);
    setFiberCount(defaults?.fiberCount ?? defaultFiberCount(cableTypeToDraw));
    setStartEquipmentId(start);
    setEndEquipmentId(end);
    // Only a port the person already picked (for example from the PON port panel). Never the first free one.
    setStartPortName(defaults?.startPortName ?? '');
    setEndPortName(defaults?.endPortName);
    setColorHex(defaults?.colorHex);
    setColorScheme('');
    setTubeColorScheme('');
    setTubeMode('none');
    setFibersPerTube(12);
    setTubeSizes(['12']);
    setLayoutSource('');
    setPoleIds([]);
    setPoleStatus('');
    setDuctChoice('');
    setSlack([]);
    setStep('type');
  }, [isCableWizardOpen]);

  const coords: [number, number][] = useMemo(() => {
    if (activeDrawingPoints.length >= 2) return activeDrawingPoints;
    const s = equipments.find((e) => e.id === startEquipmentId);
    const e = equipments.find((x) => x.id === endEquipmentId);
    return s && e
      ? [
          [s.lat, s.lng],
          [e.lat, e.lng],
        ]
      : [];
  }, [activeDrawingPoints, equipments, startEquipmentId, endEquipmentId]);
  const drawn = activeDrawingPoints.length >= 2;
  const nearPoles = useMemo(() => (drawn ? polesNearLine({ equipment: equipments }, activeDrawingPoints, ospSettings) : []), [drawn, equipments, activeDrawingPoints, ospSettings]);
  const nearDucts = useMemo(() => (drawn ? ductsAlongLine({ ducts }, activeDrawingPoints, ospSettings) : []), [drawn, ducts, activeDrawingPoints, ospSettings]);

  if (!isCableWizardOpen) return null;

  const isCoax = cableType === 'Coaxial Cable';
  const startEquipment = equipments.find((e) => e.id === startEquipmentId);
  const endEquipment = equipments.find((e) => e.id === endEquipmentId);
  const ponOptions = startEquipment?.type === 'OLT' ? buildOltPonPorts(startEquipment) : [];
  // The PON port the person picked, if any. "None" and "not chosen yet" both write no port link.
  const chosenPon = startPortName && startPortName !== NO_PON ? startPortName : undefined;

  const routeLength = coords.length >= 2 ? Math.round(polylineLengthMeters(coords)) : 0;
  const availableCores = fiberCount - reservedCores - damagedCores;
  const coreCounts = CORE_COUNTS.includes(fiberCount) ? CORE_COUNTS : [fiberCount, ...CORE_COUNTS];
  const nameOf = (id: string) => {
    const eq = equipments.find((e) => e.id === id);
    return eq ? `${eq.name} (${eq.id})` : id;
  };
  const hasProposal = !!proposedStart || !!proposedEnd;
  const knownSchemes = schemes.filter((s) => s.id !== UNKNOWN_SCHEME_ID);
  const tubeDivisors = Array.from({ length: fiberCount }, (_, i) => i + 1).filter((n) => fiberCount % n === 0 && n > 1);
  const tubes = tubeMode === 'mixed' ? tubeSizes.map((t) => ({ fiberCount: Math.trunc(Number(t)) })) : undefined;
  const tubeProblem = isCoax
    ? undefined
    : tubeMode === 'same' && fiberCount % fibersPerTube !== 0
      ? `${fiberCount} fibres cannot be split into tubes of ${fibersPerTube}.`
      : tubes
        ? tubeRecordsProblem({ fiberCount, tubes: tubes.map((t, i) => ({ number: i + 1, fiberCount: t.fiberCount })) })
        : undefined;
  const buildProblem = cableBuildProblem({ ...build, type: cableType });
  const slackProblem = slack.some((r) => !r.structureId || !(Number(r.length) > 0)) ? 'Each slack loop needs its place and a length above 0 m.' : '';
  const poleProblem = poleIds.length > 0 && !poleStatus ? 'Say whether the cable is planned or already on the ticked poles.' : '';
  const chosenDuct = nearDucts.find((d) => ductChoice.startsWith(`${d.duct.id}|`))?.duct;

  const slackPlaces = [
    ...(startEquipment ? [startEquipment] : []),
    ...(endEquipment ? [endEquipment] : []),
    ...nearPoles.map((p) => p.structure).filter((p) => p.id !== startEquipmentId && p.id !== endEquipmentId),
  ];

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

  /** Keeps what was chosen, closes the form and opens the cable tool to draw the route. */
  const drawOnMap = () => {
    const map = useMapStore.getState();
    map.resetSketches();
    map.setCableTypeToDraw(cableType);
    map.setCableDraftDefaults({
      startEquipmentId: startEquipmentId || undefined,
      endEquipmentId: endEquipmentId || undefined,
      startPortName: startPortName || undefined,
      endPortName,
      fiberCount,
      colorHex,
    });
    if (startEquipment) map.setDrawingPoints([[startEquipment.lat, startEquipment.lng]]);
    map.setActiveTool('draw_cable');
    setModalOpen('cableWizard', false);
    showToast('info', 'Draw the route', 'Tap each bend of the cable on the map, then tap Finish. The form opens again.');
  };

  const handleFinish = async () => {
    if (coords.length < 2) {
      showToast('error', 'Route Missing', 'Draw a route on the map, or choose both start and end equipment.');
      setStep('route');
      return;
    }
    if (startEquipmentId && startEquipmentId === endEquipmentId) {
      showToast('error', 'Invalid Endpoints', 'A cable must end at different equipment from where it starts.');
      setStep('ends');
      return;
    }
    if (reservedCores < 0 || damagedCores < 0 || availableCores < 0) {
      showToast('error', 'Invalid Core Counts', `Reserved and damaged cores cannot exceed ${fiberCount} in total.`);
      setStep('cores');
      return;
    }
    if (tubeProblem) {
      showToast('error', 'Tubes do not add up', `${tubeProblem} Check the drum sheet.`);
      setStep('cores');
      return;
    }
    if (buildProblem) {
      showToast('error', 'Check the cable details', buildProblem);
      setStep('type');
      return;
    }
    if (poleProblem || slackProblem) {
      showToast('error', 'Not finished', poleProblem || slackProblem);
      setStep(poleProblem ? 'support' : 'slack');
      return;
    }

    // No route drawn: the line is only straight between the two ends. Say so, never pass it off as the route.
    const straight = activeDrawingPoints.length < 2;
    // Warn, do not block: say what a blank end means and let the person decide.
    const problems = [
      straight && 'No route was drawn, so the cable is saved as a straight line between its two ends. Its length is not the real length.',
      !startEquipmentId && 'The start is not connected to any equipment.',
      !endEquipmentId && 'The end is not connected to any equipment.',
      startEquipmentId && ponOptions.length > 0 && !chosenPon && 'No OLT PON port is chosen.',
    ].filter(Boolean) as string[];
    if (problems.length > 0) {
      const unconnected = problems.length > (straight ? 1 : 0);
      const unconfirmed = hasProposal ? '\n\nThe line touches equipment you have not confirmed. Go back and tap "Yes, connect" to use it.' : '';
      const accepted = await requestConfirm({
        title: unconnected ? 'Save a cable that is not connected?' : 'Save without a drawn route?',
        message: `${problems.join(' ')}${unconnected ? '\n\nCustomers on this cable cannot be traced back to the OLT until it is connected.' : ''}${unconfirmed}`,
        confirmLabel: unconnected ? 'Save without connecting' : 'Save straight line',
        cancelLabel: 'Go back',
      });
      if (!accepted) return;
    }
    // Same two ends along the same line: ask "same cable?", never block.
    const twin = await askSameCable({ id: cableId.trim(), startEquipmentId: startEquipmentId || undefined, endEquipmentId: endEquipmentId || undefined, coordinates: coords });
    if (twin === false) return;

    const straightNote = 'Drawn straight between its ends: the real route is not drawn yet.';
    const savedRemarks = [remarks.trim(), straight ? straightNote : ''].filter(Boolean).join(' ');
    const [ductId, subductId, microductId] = ductChoice ? ductChoice.split('|') : [];

    setSaving(true);
    let created: Cable | null;
    try {
      created = await saveNewCable({
        draft: {
          id: cableId.trim() || undefined,
          name:
            cableName.trim() ||
            (startEquipmentId && endEquipmentId ? `${startEquipmentId} → ${endEquipmentId}` : 'New Fiber Route'),
          type: cableType,
          manufacturer: manufacturer.trim() || undefined,
          fiberCount,
          cores: buildCoresWithCapacity(fiberCount, reservedCores, damagedCores),
          installationType: build.installationType,
          ...(isCoax ? {} : { fiberStandard: build.fiberStandard, fiberMode: build.fiberMode }),
          sheath: build.sheath,
          outerDiameterMm: build.outerDiameterMm,
          routeStatus: routeStatus || undefined,
          owner: owner.trim(),
          remarks: savedRemarks || undefined,
          startEquipmentId: startEquipmentId || undefined,
          endEquipmentId: endEquipmentId || undefined,
          startPortName: ponOptions.length > 0 ? chosenPon : undefined,
          endPortName,
          colorHex,
          coordinates: coords,
        },
        ...(!isCoax && (colorScheme || tubeColorScheme || tubeMode !== 'none' || layoutSource.trim())
          ? {
              layout: {
                colorScheme: colorScheme || undefined,
                tubeColorScheme: tubeColorScheme || undefined,
                ...(tubeMode === 'same' ? { fibersPerTube } : {}),
                ...(tubeMode === 'mixed' && tubes ? { tubes } : {}),
                layoutSource: layoutSource.trim() || undefined,
              },
            }
          : {}),
        ...(poleIds.length > 0 && poleStatus ? { poles: { ids: poleIds, status: poleStatus } } : {}),
        ...(ductId ? { duct: { ductId, ...(subductId ? { subductId } : {}), ...(microductId ? { microductId } : {}) } } : {}),
        ...(slack.length ? { slackLoops: slack.map((r) => ({ structureId: r.structureId, lengthMeters: Number(r.length) })) } : {}),
      });
    } finally {
      setSaving(false);
    }

    if (created && problems.length > 0) {
      logAudit('CABLE_SAVED_UNCONNECTED', `Saved ${created.id} after a warning: ${problems.join(' ')}`, created.id, 'Cable');
    }
    if (created && twin) logDifferentCable(created, twin);
    if (created) {
      setActiveDrawingPoints([]);
      useMapStore.getState().setCableDraftDefaults(null);
      setModalOpen('cableWizard', false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const go = (delta: number) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, stepIndex + delta))].key);

  const radioTile = (checked: boolean, onSelect: () => void, title: string, detail?: string, testId?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      data-testid={testId}
      className={`flex min-h-[52px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
        {checked && <Check className="h-3 w-3 text-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-slate-900">{title}</span>
        {detail && <span className="block text-[12px] text-slate-500">{detail}</span>}
      </span>
    </button>
  );

  const endWarning =
    (!startEquipmentId || !endEquipmentId || (ponOptions.length > 0 && !chosenPon)) &&
    (!startEquipmentId || !endEquipmentId
      ? 'Not connected yet: customers on this cable cannot be traced back to the OLT until both ends are chosen.'
      : startPortName === NO_PON
        ? 'No PON port: customers on this cable cannot be traced to a port.'
        : 'Choose the PON port this cable is plugged into (or None), or customers on this cable cannot be traced to a port.');

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
              <CableIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-[15px] text-slate-900">Save Cable</h2>
              <p className="truncate text-[12px] text-slate-500">
                Step {stepIndex + 1} of {STEPS.length} ·{' '}
                {coords.length >= 2 ? `${coords.length} route points · ${routeLength.toLocaleString()} m` : 'Choose where this cable starts and ends'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setModalOpen('cableWizard', false)}
            className="flex h-12 w-12 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Steps" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 py-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(s.key)}
              aria-current={s.key === step ? 'step' : undefined}
              data-testid={`cable-step-${s.key}`}
              className={`min-h-[40px] shrink-0 rounded-full px-3 text-[12px] font-semibold ${s.key === step ? 'bg-blue-600 text-white' : i < stepIndex ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'}`}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[14px] sm:p-6">
          {step === 'type' && (
            <>
              <div>
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
                    setBuild((b) => ({ ...b, installationType: installationFor(type), ...(type === 'Coaxial Cable' ? { fiberStandard: undefined, fiberMode: undefined } : {}) }));
                  }}
                  className={fieldClass}
                >
                  {CABLE_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[12px] text-slate-500">{CABLE_TYPES.find((t) => t.type === cableType)?.desc}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="cable-name" className={labelClass}>
                    Cable name
                  </label>
                  <input id="cable-name" type="text" value={cableName} onChange={(e) => setCableName(e.target.value)} placeholder="Named after its endpoints if blank" className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="cable-id" className={labelClass}>
                    Cable ID
                  </label>
                  <input id="cable-id" type="text" value={cableId} onChange={(e) => setCableId(e.target.value)} className={fieldClass} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-[13px] font-semibold text-slate-700">How it is made (optional, from the drum sheet)</p>
                <CableBuildFields value={build} onChange={setBuild} coax={isCoax} idPrefix="cable" />
                {buildProblem && (
                  <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                    {buildProblem}
                  </p>
                )}
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cable-maker" className={labelClass}>
                      Manufacturer
                    </label>
                    <input id="cable-maker" type="text" placeholder="Not recorded" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label htmlFor="cable-owner" className={labelClass}>
                      Owner / operator
                    </label>
                    <input id="cable-owner" type="text" placeholder="Not recorded" value={owner} onChange={(e) => setOwner(e.target.value)} className={fieldClass} />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'cores' && (
            <>
              <div>
                <label htmlFor="cable-cores" className={labelClass}>
                  Total {isCoax ? 'conductors' : 'fibres (cores)'}
                </label>
                <select id="cable-cores" value={fiberCount} onChange={(e) => setFiberCount(Number(e.target.value))} className={fieldClass}>
                  {coreCounts.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[12px] text-slate-500">A typical count for this kind is shown first. Change it to what is printed on the cable.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cable-reserved" className={labelClass}>
                    Reserved cores
                  </label>
                  <input id="cable-reserved" type="number" inputMode="numeric" min="0" max={fiberCount} value={reservedCores} onChange={(e) => setReservedCores(Math.trunc(Number(e.target.value)))} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="cable-damaged" className={labelClass}>
                    Damaged cores
                  </label>
                  <input id="cable-damaged" type="number" inputMode="numeric" min="0" max={fiberCount} value={damagedCores} onChange={(e) => setDamagedCores(Math.trunc(Number(e.target.value)))} className={fieldClass} />
                </div>
              </div>
              <p className="text-[12px] text-slate-500">
                {Math.max(0, availableCores)} of {fiberCount} cores will be available. Reserved and damaged cores are taken from the highest core numbers.
              </p>
              {!isCoax && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <p className="text-[13px] font-semibold text-slate-700">Tubes and colours (from the drum sheet)</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="cable-scheme" className={labelClass}>
                        Fibre colours
                      </label>
                      <select id="cable-scheme" value={colorScheme} onChange={(e) => setColorScheme(e.target.value)} className={fieldClass}>
                        <option value="">Not known</option>
                        {knownSchemes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cable-tube-scheme" className={labelClass}>
                        Tube colours
                      </label>
                      <select id="cable-tube-scheme" value={tubeColorScheme} onChange={(e) => setTubeColorScheme(e.target.value)} className={fieldClass}>
                        <option value="">Not known</option>
                        {knownSchemes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2" role="radiogroup" aria-label="Tubes">
                    {radioTile(tubeMode === 'none', () => setTubeMode('none'), 'Tubes not recorded', 'Fibres are known by number only.', 'cable-tubes-none')}
                    {radioTile(tubeMode === 'same', () => setTubeMode('same'), 'All tubes the same size', undefined, 'cable-tubes-same')}
                    {tubeMode === 'same' && (
                      <div className="pl-8">
                        <label htmlFor="cable-fpt" className={labelClass}>
                          Fibres in each tube
                        </label>
                        <select id="cable-fpt" value={fibersPerTube} onChange={(e) => setFibersPerTube(Number(e.target.value))} className={fieldClass}>
                          {(tubeDivisors.includes(fibersPerTube) ? tubeDivisors : [fibersPerTube, ...tubeDivisors]).map((n) => (
                            <option key={n} value={n}>
                              {n} ({fiberCount % n === 0 ? `${fiberCount / n} tubes` : 'does not fit'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {radioTile(tubeMode === 'mixed', () => setTubeMode('mixed'), 'Tubes of different sizes', 'Type each tube in order, tube 1 first.', 'cable-tubes-mixed')}
                    {tubeMode === 'mixed' && (
                      <div className="space-y-2 pl-8">
                        {tubeSizes.map((size, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[13px] text-slate-600">Tube {i + 1}</span>
                            <input
                              aria-label={`Fibres in tube ${i + 1}`}
                              inputMode="numeric"
                              value={size}
                              onChange={(e) => setTubeSizes((all) => all.map((s, j) => (j === i ? e.target.value.replace(/[^0-9]/g, '') : s)))}
                              className={fieldClass}
                            />
                            <button type="button" aria-label={`Remove tube ${i + 1}`} disabled={tubeSizes.length <= 1} onClick={() => setTubeSizes((all) => all.filter((_, j) => j !== i))} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setTubeSizes((all) => [...all, ''])} className={`${bigButton} flex items-center gap-1.5 border border-slate-200 text-slate-700`}>
                          <Plus className="h-4 w-4" /> Add a tube
                        </button>
                      </div>
                    )}
                  </div>
                  {tubeProblem && (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                      {tubeProblem}
                    </p>
                  )}
                  <div>
                    <label htmlFor="cable-layout-source" className={labelClass}>
                      Where this came from
                    </label>
                    <input id="cable-layout-source" type="text" placeholder="Such as: drum sheet, checked 4 Nov" value={layoutSource} onChange={(e) => setLayoutSource(e.target.value)} className={fieldClass} />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'ends' && (
            <>
              {hasProposal && (
                <div role="status" className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-[14px] text-blue-950">
                  <p className="font-semibold">Your line touches:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposedStart && <li>Start: {nameOf(proposedStart)}</li>}
                    {proposedEnd && <li>End: {nameOf(proposedEnd)}</li>}
                  </ul>
                  <p className="mt-1">Connect this cable to {proposedStart && proposedEnd ? 'them' : 'it'}?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={confirmProposal} className={`${bigButton} bg-blue-600 text-white hover:bg-blue-500`}>
                      Yes, connect
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProposedStart('');
                        setProposedEnd('');
                      }}
                      className={`${bigButton} border border-blue-300 bg-white text-blue-900`}
                    >
                      No, leave blank
                    </button>
                  </div>
                </div>
              )}
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
                  <select id="cable-pon" value={startPortName} onChange={(e) => setStartPortName(e.target.value)} className={fieldClass}>
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
              {endWarning && (
                <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  {endWarning}
                </p>
              )}
            </>
          )}

          {step === 'route' && (
            <>
              {drawn ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Drawn on the map: {activeDrawingPoints.length} points, {routeLength.toLocaleString()} m. This is the drawn length; the sheath and OTDR lengths are recorded later, on the cable.
                </p>
              ) : (
                <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  No route is drawn.{' '}
                  {coords.length >= 2
                    ? `If you save now, the cable is a straight line between its two ends (${routeLength.toLocaleString()} m), and that is not its real length.`
                    : 'Choose both ends, or draw the route on the map.'}
                </p>
              )}
              <button type="button" onClick={drawOnMap} className={`${bigButton} flex w-full items-center justify-center gap-2 border border-blue-300 bg-white text-blue-800`} data-testid="cable-draw-on-map">
                <PenLine className="h-4 w-4" /> {drawn ? 'Draw the route again on the map' : 'Draw the route on the map'}
              </button>
              <div>
                <label htmlFor="cable-status" className={labelClass}>
                  Route status
                </label>
                <select id="cable-status" value={routeStatus} onChange={(e) => setRouteStatus(e.target.value as RouteStatus | '')} className={fieldClass}>
                  <option value="">Not recorded</option>
                  <option value="Active">Existing / installed</option>
                  <option value="Proposed">Proposed</option>
                  <option value="Under Construction">Under construction</option>
                  <option value="Maintenance">Maintenance / repair</option>
                </select>
              </div>
            </>
          )}

          {step === 'support' && (
            <>
              {!drawn && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Draw the route first; then the poles and ducts along it are listed here.</p>}
              {drawn && (
                <>
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-[13px] font-semibold text-slate-700">Poles near the line. Tick only the ones that carry this cable.</legend>
                    {nearPoles.length === 0 && <p className="text-[13px] text-slate-500">No poles are placed near this line.</p>}
                    {nearPoles.map(({ structure, distanceMeters }) => {
                      const ticked = poleIds.includes(structure.id);
                      return (
                        <label key={structure.id} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${ticked ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                          <input type="checkbox" className="h-5 w-5" checked={ticked} onChange={() => setPoleIds((ids) => (ticked ? ids.filter((x) => x !== structure.id) : [...ids, structure.id]))} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-slate-900">{structure.name}</span>
                            <span className="block text-[12px] text-slate-500">About {Math.round(distanceMeters)} m from the line</span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                  {poleIds.length > 0 && (
                    <div className="space-y-2" role="radiogroup" aria-label="Is it on these poles yet?">
                      <p className="text-[13px] font-semibold text-slate-700">Is the cable on these poles yet?</p>
                      {radioTile(poleStatus === 'planned', () => setPoleStatus('planned'), 'Planned, not yet hung')}
                      {radioTile(poleStatus === 'built', () => setPoleStatus('built'), 'Yes, it is on them')}
                    </div>
                  )}
                  <div className="space-y-2" role="radiogroup" aria-label="Duct">
                    <p className="text-[13px] font-semibold text-slate-700">Is it in a duct?</p>
                    {radioTile(ductChoice === '', () => setDuctChoice(''), 'Not in a duct, or not recorded')}
                    {nearDucts.flatMap(({ duct }) => [
                      radioTile(ductChoice === `${duct.id}|`, () => setDuctChoice(`${duct.id}|`), duct.name, 'In the duct itself'),
                      ...duct.subducts.flatMap((s) => [
                        radioTile(ductChoice === `${duct.id}|${s.id}`, () => setDuctChoice(`${duct.id}|${s.id}`), `${duct.name}, way ${s.label}`, s.condition === 'blocked' ? 'Recorded as blocked' : undefined),
                        ...(s.microducts ?? []).map((m) => radioTile(ductChoice === `${duct.id}|${s.id}|${m.id}`, () => setDuctChoice(`${duct.id}|${s.id}|${m.id}`), `${duct.name}, way ${s.label}, microduct ${m.label}`)),
                      ]),
                    ])}
                    {nearDucts.length === 0 && <p className="text-[13px] text-slate-500">No duct is drawn along this line.</p>}
                    {chosenDuct && <p className="text-[12px] text-slate-500">The duct fill is checked when you save.</p>}
                  </div>
                </>
              )}
            </>
          )}

          {step === 'slack' && (
            <>
              <p className="text-[13px] text-slate-600">Spare cable left coiled on the route. Add each loop with the length written down or read from the cable marks. Leave empty if none.</p>
              {slack.map((row, i) => (
                <div key={row.key} className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div>
                    <label htmlFor={`slack-place-${i}`} className={labelClass}>
                      Where is loop {i + 1}?
                    </label>
                    <select id={`slack-place-${i}`} value={row.structureId} onChange={(e) => setSlack((all) => all.map((r) => (r.key === row.key ? { ...r, structureId: e.target.value } : r)))} className={fieldClass}>
                      <option value="">Choose the pole, chamber or box</option>
                      {slackPlaces.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor={`slack-length-${i}`} className={labelClass}>
                        Length (m)
                      </label>
                      <input id={`slack-length-${i}`} inputMode="numeric" value={row.length} onChange={(e) => setSlack((all) => all.map((r) => (r.key === row.key ? { ...r, length: e.target.value.replace(/[^0-9]/g, '') } : r)))} className={fieldClass} />
                    </div>
                    <button type="button" aria-label={`Remove loop ${i + 1}`} onClick={() => setSlack((all) => all.filter((r) => r.key !== row.key))} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {slackPlaces.length === 0 ? (
                <p className="text-[13px] text-slate-500">Choose the ends or draw the route first; a loop is recorded at a pole, chamber or box.</p>
              ) : (
                <button type="button" onClick={() => setSlack((all) => [...all, { key: `${Date.now()}-${all.length}`, structureId: '', length: '' }])} className={`${bigButton} flex items-center gap-1.5 border border-slate-200 text-slate-700`}>
                  <Plus className="h-4 w-4" /> Add a slack loop
                </button>
              )}
              {slackProblem && <p className="text-[13px] text-red-700">{slackProblem}</p>}
            </>
          )}

          {step === 'check' && (
            <>
              <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[14px]">
                <li>
                  <strong>{cableName.trim() || (startEquipmentId && endEquipmentId ? `${startEquipmentId} → ${endEquipmentId}` : 'New Fiber Route')}</strong> · {CABLE_TYPES.find((t) => t.type === cableType)?.label}
                </li>
                <li>
                  {fiberCount} {isCoax ? 'conductor(s)' : 'fibres'}
                  {!isCoax && ` · tubes ${tubeMode === 'none' ? 'not recorded' : tubeMode === 'same' ? `of ${fibersPerTube}` : `of ${tubeSizes.join(', ')}`} · colours ${knownSchemes.find((s) => s.id === colorScheme)?.name ?? 'not known'}`}
                </li>
                <li>
                  From {startEquipmentId ? nameOf(startEquipmentId) : 'not connected'}
                  {chosenPon ? ` (${chosenPon})` : ''} to {endEquipmentId ? nameOf(endEquipmentId) : 'not connected'}
                </li>
                <li>{drawn ? `Drawn route, ${routeLength.toLocaleString()} m` : coords.length >= 2 ? `Straight line, ${routeLength.toLocaleString()} m (not the real route)` : 'No route yet'}</li>
                <li>
                  {poleIds.length ? `On ${poleIds.length} pole(s), ${poleStatus || 'state not chosen'}` : 'No poles ticked'} · {chosenDuct ? `in ${chosenDuct.name}` : 'not in a duct'} · {slack.length ? `${slack.length} slack loop(s)` : 'no slack loop'}
                </li>
              </ul>
              {[tubeProblem, buildProblem, poleProblem, slackProblem].filter(Boolean).map((p) => (
                <p key={String(p)} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                  {p}
                </p>
              ))}
              {endWarning && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{endWarning}</p>}
              <div>
                <label htmlFor="cable-remarks" className={labelClass}>
                  Remarks
                </label>
                <textarea id="cable-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={fieldClass} />
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center gap-2 sm:px-6">
          {stepIndex === 0 ? (
            <button type="button" onClick={() => setModalOpen('cableWizard', false)} className={`${bigButton} border border-slate-200 text-slate-700 hover:bg-slate-100`}>
              Cancel
            </button>
          ) : (
            <button type="button" onClick={() => go(-1)} className={`${bigButton} flex items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-100`}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}
          <div className="flex-1" />
          {step !== 'check' && (
            <button type="button" onClick={() => go(1)} className={`${bigButton} flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-500`} data-testid="cable-step-next">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === 'check' && (
            <button type="button" disabled={saving} onClick={() => void handleFinish()} className={`${bigButton} flex items-center gap-1.5 bg-blue-600 text-white shadow-xs hover:bg-blue-500 disabled:opacity-50`}>
              <Check className="w-4 h-4" /> Save Cable
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
