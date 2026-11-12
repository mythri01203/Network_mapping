import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Home,
  Layers,
  Minus,
  PersonStanding,
  Plus,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { useLocation } from 'react-router';

import { useOpenView, useShowOnMap } from '../../app/views';
import { useFieldLanguage } from '../../i18n/useT';
import { useMapStore } from '../../stores/mapStore';
import { selectColorSchemes, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { type SelectedObject, useUiStore } from '../../stores/uiStore';
import { PropertiesPanel } from '../inspector/PropertiesPanel';
import { TILE_PROVIDERS } from '../map/leaflet/tileProviders';
import { View3DEngine, webglAvailable } from './engine/Engine';
import type { FiberFilter } from './engine/fibers';
import type { PickInfo } from './engine/kit';
import type { GroundState, TileSource } from './engine/mapGround';
import type { LabelText } from './engine/world';
import { LANG_NAMES_3D, type Lang3D, LANGS_3D, type Msg3DKey, t3d } from './i18n';
import { createBenchNetwork, createDemoNetwork, DEMO_ORIGIN } from './scene/demoNetwork';
import { makeProjection } from './scene/geoLocal';
import { portColorCode } from './scene/models';
import { presetAvailable, type PresetKey } from './scene/presets';
import { findCustomer, itemId, type Scene3DInput, toScene3D } from './scene/toScene3D';
import type { Scene3D } from './scene/types';
import { OnboardingTour, WebGLFallback } from './ui/OnboardingTour';
import {
  Btn,
  CustomerCard,
  EquipmentCard,
  type Fact,
  FindHouse,
  FreePlaces,
  HelpBubble,
  Legend,
  MappingPanel,
  NetworkSummary,
  Notes,
  type PortRow,
  PresetPanel,
} from './ui/Panels';
import { type StreetMarker, StreetViewPanel } from './ui/StreetViewPanel';
import { panelClass, type Tone } from './ui/style';
import { type GroundChoice, type OriginChoice, type ThemeChoice, useView3DStore } from './view3dStore';

/**
 * The 3D network view. It draws the same records as the 2D map through `toScene3D`, keeps the
 * selection in step with the map (pick in 3D selects in 2D, and the other way), and owns nothing
 * but its camera and panels. Demo data is drawn here only and never saved.
 */

function usePrefersDark() {
  const query =
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return dark;
}

/** The origin of local metres for the person's choice. `null` lets `toScene3D` use the first OLT. */
function originFor(
  choice: OriginChoice,
  input: Scene3DInput,
  start: readonly [number, number] | null,
): { lat: number; lng: number } | null {
  if (choice === 'start' && start) return { lat: start[0], lng: start[1] };
  if (choice === 'middle') {
    const pts = [
      ...input.equipment.map((e) => [e.lat, e.lng] as const),
      ...input.customers.map((c) => [c.lat, c.lng] as const),
    ];
    if (pts.length)
      return {
        lat: pts.reduce((s, p) => s + p[0], 0) / pts.length,
        lng: pts.reduce((s, p) => s + p[1], 0) / pts.length,
      };
  }
  if (choice === 'olt' && !input.equipment.some((e) => e.type === 'OLT') && start)
    return { lat: start[0], lng: start[1] };
  return null;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useNetworkInput(): Scene3DInput & { settingsKey: unknown } {
  const equipment = useNetworkStore((s) => s.equipment);
  const cables = useNetworkStore((s) => s.cables);
  const splitters = useNetworkStore((s) => s.splitters);
  const closures = useNetworkStore((s) => s.closures);
  const customers = useNetworkStore((s) => s.customers);
  const spans = useNetworkStore((s) => s.spans);
  const attachments = useNetworkStore((s) => s.attachments);
  const onuStatuses = useNetworkStore((s) => s.onuStatuses);
  const deviceStatuses = useNetworkStore((s) => s.deviceStatuses);
  const monitoringSources = useNetworkStore((s) => s.monitoringSources);
  const settingsKey = useNetworkStore((s) => s.settings);
  return useMemo(
    () => ({
      equipment,
      cables,
      splitters,
      closures,
      customers,
      spans,
      attachments,
      onuStatuses,
      deviceStatuses,
      monitoringSources,
      settingsKey,
    }),
    [
      equipment,
      cables,
      splitters,
      closures,
      customers,
      spans,
      attachments,
      onuStatuses,
      deviceStatuses,
      monitoringSources,
      settingsKey,
    ],
  );
}

export function View3DView() {
  const prefs = useView3DStore();
  const fieldLang = useFieldLanguage((s) => s.lang);
  const lang: Lang3D = prefs.lang ?? (fieldLang === 'te' || fieldLang === 'kn' ? fieldLang : 'en');
  const systemDark = usePrefersDark();
  const dark = prefs.theme === 'auto' ? systemDark : prefs.theme === 'dark';
  const tone: Tone = useMemo(() => ({ dark }), [dark]);
  const openView = useOpenView();
  const showOnMap = useShowOnMap();
  const [supported] = useState(() => webglAvailable());

  const real = useNetworkInput();
  const optical = useNetworkStore(selectOpticalSettings);
  const schemes = useNetworkStore(selectColorSchemes);
  const projectStart = useNetworkStore((s) => s.projectStartPoint);
  // The ground: the same street tiles as the 2D map, the satellite picture, or plain grass.
  const tileProvider = useMapStore((s) => s.tileProvider);
  const groundSource: TileSource | null = useMemo(() => {
    if (prefs.ground === 'plain') return null;
    // The plain satellite picture (no printed names: on the ground they would be metres tall).
    if (prefs.ground === 'satellite')
      return {
        ...TILE_PROVIDERS.google_satellite,
        url: TILE_PROVIDERS.google_satellite.url.replace('lyrs=y', 'lyrs=s'),
        maxZoom3d: 19,
      };
    const tiles = TILE_PROVIDERS[tileProvider] ?? TILE_PROVIDERS.google_streets;
    return { ...tiles, maxZoom3d: 18 };
  }, [prefs.ground, tileProvider]);
  const [groundState, setGroundState] = useState<GroundState>('off');
  const attribution = groundSource?.attribution.replace('&copy;', '©') ?? '';
  // `/3d?bench=N`: N copies of the demo network (100 houses each) to measure the frame rate.
  const bench = Math.min(20, Number(new URLSearchParams(useLocation().search).get('bench')) || 0);
  const demoInput = useMemo(
    () => (bench > 0 ? createBenchNetwork(bench) : prefs.demo ? createDemoNetwork() : null),
    [bench, prefs.demo],
  );
  const scene: Scene3D = useMemo(() => {
    if (demoInput) return toScene3D(demoInput, { origin: DEMO_ORIGIN, optical, schemes, isDemo: true });
    return toScene3D(real, { origin: originFor(prefs.origin, real, projectStart), optical, schemes });
  }, [demoInput, real, optical, schemes, projectStart, prefs.origin]);
  const isEmpty = scene.racks.length + scene.poles.length + scene.boxes.length + scene.houses.length === 0;

  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<View3DEngine | null>(null);
  // What was selected on the 2D map when the person switched to 3D: focused once the scene is drawn.
  const [initialSel] = useState<SelectedObject | null>(() =>
    useView3DStore.getState().demo ? null : useUiStore.getState().selectedObject,
  );
  const startsOnSelection = initialSel?.type === 'customer' || initialSel?.type === 'equipment';
  const [preset, setPreset] = useState<PresetKey | null>(startsOnSelection ? null : 'ov');
  const [caption, setCaption] = useState<PresetKey>('ov');
  const [filter, setFilter] = useState<FiberFilter>({ kind: 'all' });
  const [ponKey, setPonKey] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(
    initialSel?.type === 'customer' ? initialSel.data.id : null,
  );
  const [cableId, setCableId] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(
    initialSel?.type === 'equipment' ? initialSel.data.id : null,
  );
  // On a phone the panels start folded so the scene stays visible.
  const [isPhone] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767px)').matches,
  );
  // On a laptop screen the panels would cover the picture, so they start folded: the fiber panel
  // opens by itself when something is picked, and the extra options are behind "More options".
  const [isWide] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1600px)').matches,
  );
  const [panelOpen, setPanelOpen] = useState(isWide);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(!isPhone);
  const [ready, setReady] = useState(false);

  const pon =
    scene.pons.find((p) => p.key === ponKey) ?? scene.pons.find((p) => p.levels.length) ?? scene.pons[0] ?? null;
  const customer = customerId ? scene.customers.find((c) => c.customerId === customerId) : undefined;
  const house = customer ? scene.houses.find((h) => h.id === customer.houseId) : undefined;
  const others = house
    ? scene.customers.filter((c) => house.customerIds.includes(c.customerId) && c.customerId !== customerId)
    : [];

  // Editing in 3D uses the app's own tools, so every change passes the same checks and is saved
  // the same way as on the 2D map: the inspector (details, port manager, connection tools) opens
  // beside the scene, and the "Add customer" wizard opens on the picked box.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const wizardPicking = useUiStore((s) => s.customerWizardPicking);
  const groundTapRef = useRef<(p: { x: number; z: number }) => boolean>(() => false);
  useEffect(() => {
    groundTapRef.current = (point) => {
      const ui = useUiStore.getState();
      if (!ui.customerWizardPicking || scene.isDemo) return false;
      const geo = makeProjection(scene.origin).toGeo(point);
      ui.setCustomerWizardPick({ lat: geo.lat, lng: geo.lng });
      return true;
    };
  }, [scene]);
  /** Makes the app's selection the record shown in the card, so its tools open on that record. */
  const selectShown = () => {
    if (scene.isDemo) return;
    const net = useNetworkStore.getState();
    const ui = useUiStore.getState();
    const cust = customerId ? net.customers.find((c) => c.id === customerId) : undefined;
    const cab = cableId ? net.cables.find((c) => c.id === cableId) : undefined;
    const eq = equipmentId ? net.equipment.find((e) => e.id === equipmentId) : undefined;
    if (cust) ui.select({ type: 'customer', data: cust });
    else if (cab) ui.select({ type: 'cable', data: cab });
    else if (eq) ui.select({ type: 'equipment', data: eq });
  };
  // Street photo (Google Street View) of the selected record, or of what the camera looks at,
  // with the mapped records within reach marked on it.
  const [street, setStreet] = useState<{ at: { lat: number; lng: number }; markers: StreetMarker[] } | null>(null);
  const openStreet = () => {
    if (scene.isDemo) return;
    const proj = makeProjection(scene.origin);
    const net = useNetworkStore.getState();
    const cust = customerId ? net.customers.find((c) => c.id === customerId) : undefined;
    const eq = equipmentId ? net.equipment.find((e) => e.id === equipmentId) : undefined;
    const local = cust
      ? proj.toLocal(cust.lat, cust.lng)
      : eq
        ? proj.toLocal(eq.lat, eq.lng)
        : (engine.current?.lookingAt() ?? scene.center);
    const near = (p: { x: number; z: number }, reach: number) => Math.hypot(p.x - local.x, p.z - local.z) <= reach;
    const pin = (p: { x: number; z: number }, letter: string, title: string, color: string): StreetMarker => ({
      ...proj.toGeo(p),
      letter,
      title,
      color,
    });
    const markers: StreetMarker[] = [
      ...scene.racks.filter((r) => near(r.position, 400)).map((r) => pin(r.position, 'O', r.label, '#e11d48')),
      ...scene.boxes
        .filter((b) => near(b.position, 250))
        .map((b) => pin(b.position, b.model === 'fat' ? 'F' : 'S', b.name, b.model === 'fat' ? '#1d6fe0' : '#f97316')),
      ...scene.poles.filter((p) => near(p.position, 120)).map((p) => pin(p.position, 'P', p.name, '#6b4a2e')),
      ...scene.houses
        .filter((h) => near(h.position, 120))
        .map((h) => pin(h.position, String(h.number), `House ${h.number}`, h.inactive ? '#ef4444' : '#16a34a')),
    ].slice(0, 120);
    setStreet({ at: proj.toGeo(local), markers });
  };

  const openTools = () => {
    selectShown();
    useUiStore.getState().setPanelOpen('right', true);
    setInspectorOpen(true);
  };
  const addCustomerHere = () => {
    // The wizard starts on the box selected in the app: the one in the card.
    const eq = equipmentId ? useNetworkStore.getState().equipment.find((e) => e.id === equipmentId) : undefined;
    if (eq) useUiStore.getState().select({ type: 'equipment', data: eq });
    useUiStore.getState().setModalOpen('customerWizard', true);
  };

  // Kept current by an effect below, so the engine always calls the latest handler.
  const handlePickRef = useRef<(p: PickInfo | null) => void>(() => {});

  // Engine: made once, freed on unmount.
  useEffect(() => {
    if (!supported || !host.current) return;
    const e = new View3DEngine(
      host.current,
      {
        onPick: (pick) => handlePickRef.current(pick),
        onUserMove: () => setPreset(null),
        onGround: setGroundState,
        // While the "Add customer" wizard waits for the house position, a tap on the ground gives it.
        onGroundTap: (point) => groundTapRef.current(point),
      },
      { dark, labels: prefs.labels, pulses: prefs.pulses, reducedMotion: reducedMotion() },
    );
    engine.current = e;
    setReady(true);
    return () => {
      e.dispose();
      engine.current = null;
      setReady(false);
    };
    // Options are pushed by the effects below; the engine is made only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  useEffect(() => {
    if (!ready) return;
    engine.current?.setScene(scene);
  }, [ready, scene]);
  useEffect(() => engine.current?.setLabels(prefs.labels), [prefs.labels, ready]);
  useEffect(() => engine.current?.setPulses(prefs.pulses), [prefs.pulses, ready]);
  const labelText = useCallback<LabelText>((key, values) => t3d(lang, key, values), [lang]);
  useEffect(() => engine.current?.setText(labelText), [labelText, ready]);
  useEffect(() => engine.current?.setTheme(dark), [dark, ready]);
  useEffect(() => engine.current?.setGround(groundSource), [groundSource, ready]);

  // Selection made on the 2D map: focus it here once the scene is drawn (runs after setScene above).
  const syncedFromMap = useRef(false);
  useEffect(() => {
    if (!ready || syncedFromMap.current) return;
    syncedFromMap.current = true;
    if (initialSel?.type === 'customer') engine.current?.selectCustomer(initialSel.data.id);
    else if (initialSel?.type === 'equipment' && !engine.current?.focusEquipment(initialSel.data.id))
      engine.current?.preset('ov', true);
  }, [ready, scene, initialSel]);

  const selectInApp = useCallback(
    (selection: SelectedObject | null) => {
      if (scene.isDemo) return;
      useUiStore.getState().select(selection);
    },
    [scene.isDemo],
  );

  const pickCustomer = useCallback(
    (id: string | null) => {
      if (id) setPanelOpen(true);
      setCustomerId(id);
      setEquipmentId(null);
      setFilter({ kind: 'all' });
      engine.current?.setFilter({ kind: 'all' });
      engine.current?.selectCustomer(id);
      setPreset(null);
      if (id) setCaption('vil');
      if (id) {
        const record = useNetworkStore.getState().customers.find((c) => c.id === id);
        if (record) selectInApp({ type: 'customer', data: record });
      }
    },
    [selectInApp],
  );

  useEffect(() => {
    handlePickRef.current = (pick) => {
      if (!pick) return;
      if (pick.kind === 'house') {
        const h = scene.houses.find((x) => x.id === pick.houseId);
        const first = h
          ? scene.customers.filter((c) => h.customerIds.includes(c.customerId)).sort((a, b) => a.number - b.number)[0]
          : undefined;
        if (first) pickCustomer(first.customerId);
        return;
      }
      if (pick.kind === 'cable') {
        setPanelOpen(true);
        setCableId(pick.id);
        const record = useNetworkStore.getState().cables.find((c) => c.id === pick.id);
        if (record) selectInApp({ type: 'cable', data: record });
        return;
      }
      if (pick.kind === 'equipment') {
        setPanelOpen(true);
        setCableId(null);
        setEquipmentId(pick.id);
        setCustomerId(null);
        engine.current?.selectCustomer(null);
        const record = useNetworkStore.getState().equipment.find((e) => e.id === pick.id);
        if (record) selectInApp({ type: 'equipment', data: record });
      }
    };
  });

  const onPreset = (k: PresetKey) => {
    setPreset(k);
    setCaption(k);
    engine.current?.preset(k);
  };
  const onFilter = (f: FiberFilter) => {
    setFilter(f);
    setCustomerId(null);
    engine.current?.setFilter(f);
  };
  const onPon = (key: string) => {
    setPonKey(key);
    engine.current?.setFilter({ kind: 'pon', ponKey: key });
    setFilter({ kind: 'pon', ponKey: key });
  };
  const onFind = (q: string) => {
    const c = findCustomer(scene, q);
    if (!c) return false;
    pickCustomer(c.customerId);
    return true;
  };

  const equipmentInfo = useMemo(() => {
    if (!equipmentId) return null;
    const source = demoInput ?? real;
    const rec = source.equipment.find((e) => e.id === equipmentId);
    if (!rec) return null;
    const box = scene.boxes.find((b) => b.id === equipmentId);
    const item = scene.racks.flatMap((r) => r.items).find((i) => itemId(i) === equipmentId);
    const extra =
      item?.kind === 'olt'
        ? `${item.olt.ports.length} PON · ${item.olt.ports.filter((p) => p.state === 'in_use').length} in use · ${item.olt.cardsRecorded ? 'cards as recorded' : 'cards laid out by port count'}`
        : item?.kind === 'switch'
          ? `${item.sw.ports.length} RJ45 · ${item.sw.ports.filter((p) => p.inUse).length} in use${item.sw.portsRecorded ? '' : ' (port count not recorded: 24 drawn)'}`
          : undefined;
    return { rec, box, extra };
  }, [equipmentId, demoInput, real, scene]);

  // Numbers for the summary and the cards, all counted from the records.
  const source = demoInput ?? real;
  const summaryFacts = useMemo<Fact[]>(() => {
    const total = source.customers.length;
    const active = source.customers.filter((c) => c.status === 'Active').length;
    const ports = scene.racks.flatMap((r) => r.items).flatMap((i) => (i.kind === 'olt' ? i.olt.ports : []));
    const ponUsed = ports.filter((p) => p.state === 'in_use' || p.state === 'fault').length;
    const fat = scene.boxes.filter((b) => b.model === 'fat').flatMap((b) => b.ports);
    const fatUsed = fat.filter((p) => p.state === 'used').length;
    const outs = source.splitters.flatMap((s) => s.outputPorts ?? []);
    const outsUsed = outs.filter((o) => o.status === 'Occupied').length;
    const sizes = new Map<number, number>();
    for (const c of scene.cables) if (c.fiberCount) sizes.set(c.fiberCount, (sizes.get(c.fiberCount) ?? 0) + 1);
    const facts: Fact[] = [
      [
        t3d(lang, 'info.customers'),
        `${total} · ${t3d(lang, 'info.active')} ${active} · ${t3d(lang, 'info.inactive')} ${total - active}`,
        total - active > 0 ? undefined : 'good',
      ],
    ];
    if (ports.length)
      facts.push([
        t3d(lang, 'info.ponPorts'),
        `${ponUsed} ${t3d(lang, 'info.inUse')} · ${ports.length - ponUsed} ${t3d(lang, 'info.free')}`,
      ]);
    if (outs.length)
      facts.push([
        t3d(lang, 'info.outputs'),
        `${outsUsed} ${t3d(lang, 'info.inUse')} · ${outs.length - outsUsed} ${t3d(lang, 'info.free')}`,
      ]);
    if (fat.length)
      facts.push([
        t3d(lang, 'info.fatPorts'),
        `${fatUsed} ${t3d(lang, 'info.inUse')} · ${fat.length - fatUsed} ${t3d(lang, 'info.free')}`,
      ]);
    if (sizes.size)
      facts.push([
        t3d(lang, 'info.cables'),
        [...sizes.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([f, n]) => `${f}F ×${n}`)
          .join(' · '),
      ]);
    return facts;
  }, [source, scene, lang]);

  // The selected customer's recorded status, plan and light level.
  const customerFacts = useMemo<Fact[] | undefined>(() => {
    const rec = customerId ? source.customers.find((c) => c.id === customerId) : undefined;
    if (!rec) return undefined;
    const facts: Fact[] = [[t3d(lang, 'status'), rec.status ?? '—', rec.status === 'Active' ? 'good' : 'bad']];
    if (rec.plan) facts.push([t3d(lang, 'info.plan'), rec.plan]);
    facts.push([
      t3d(lang, 'info.rx'),
      typeof rec.rxOpticalPowerDbm === 'number'
        ? `${rec.rxOpticalPowerDbm} dBm${rec.rxSource ? ` (${rec.rxSource})` : ''}`
        : t3d(lang, 'info.rxNone'),
    ]);
    return facts;
  }, [customerId, source, lang]);

  // The selected box or OLT: outputs used and free, and the customers whose recorded path goes
  // through it (the people who lose service if it fails).
  const equipmentFacts = useMemo<{ facts: Fact[]; warning?: string } | null>(() => {
    if (!equipmentId) return null;
    const facts: Fact[] = [];
    const statusOf = new Map(source.customers.map((c) => [c.id, c.status]));
    const through = scene.customers.filter((c) =>
      c.hops.some((h) =>
        h.kind === 'splitter' ? h.boxId === equipmentId : h.kind === 'pon' && h.oltId === equipmentId,
      ),
    );
    const outs = source.splitters.filter((s) => s.terminalBoxId === equipmentId).flatMap((s) => s.outputPorts ?? []);
    if (outs.length) {
      const used = outs.filter((o) => o.status === 'Occupied').length;
      facts.push([
        t3d(lang, 'info.outputs'),
        `${used} ${t3d(lang, 'info.inUse')} · ${outs.length - used} ${t3d(lang, 'info.free')}`,
      ]);
    }
    const olt = scene.racks.flatMap((r) => r.items).find((i) => i.kind === 'olt' && i.olt.equipmentId === equipmentId);
    if (olt?.kind === 'olt') {
      const used = olt.olt.ports.filter((p) => p.state === 'in_use' || p.state === 'fault').length;
      facts.push([
        t3d(lang, 'info.ponPorts'),
        `${used} ${t3d(lang, 'info.inUse')} · ${olt.olt.ports.length - used} ${t3d(lang, 'info.free')}`,
      ]);
    }
    if (through.length) {
      const active = through.filter((c) => statusOf.get(c.customerId) === 'Active').length;
      facts.push([
        t3d(lang, 'info.served'),
        `${through.length} · ${t3d(lang, 'info.active')} ${active} · ${t3d(lang, 'info.inactive')} ${through.length - active}`,
      ]);
    }
    return { facts, warning: through.length ? t3d(lang, 'info.affected', { n: through.length }) : undefined };
  }, [equipmentId, source, scene, lang]);

  // Every output of the splitters in the selected box: colour code of its number, used or free,
  // and who or what is on it.
  const outputRows = useMemo<PortRow[]>(() => {
    if (!equipmentId) return [];
    const nameOf = new Map(source.customers.map((c) => [c.id, `${c.name} (${c.status ?? '?'})`]));
    const byDrop = new Map(source.customers.filter((c) => c.dropCableId).map((c) => [c.dropCableId, c.id]));
    return source.splitters
      .filter((s) => s.terminalBoxId === equipmentId)
      .flatMap((s) =>
        (s.outputPorts ?? []).map((o) => {
          const free = o.status !== 'Occupied';
          const cable = o.connectedDropCableId;
          const who = cable ? byDrop.get(cable) : undefined;
          return {
            key: `${s.id}#${o.portNumber}`,
            n: o.portNumber,
            chip: portColorCode(o.portNumber),
            state: free ? t3d(lang, 'info.freeOne') : t3d(lang, 'info.used'),
            free,
            text: free ? s.ratio : ((who && nameOf.get(who)) ?? cable ?? ''),
          };
        }),
      );
  }, [equipmentId, source, lang]);

  // The selected cable: size, length, and every fiber with its recorded colour and use.
  const cableInfo = useMemo(() => {
    const rec = cableId ? source.cables.find((c) => c.id === cableId) : undefined;
    if (!rec) return null;
    const facts: Fact[] = [];
    if (rec.fiberCount)
      facts.push([t3d(lang, 'info.size'), `${rec.fiberCount}F${rec.fiberStandard ? ` · ${rec.fiberStandard}` : ''}`]);
    if (rec.lengthMeters) facts.push([t3d(lang, 'info.length'), `${Math.round(rec.lengthMeters)} m`]);
    const cores = rec.cores ?? [];
    const used = cores.filter((k) => k.status === 'In Use').length;
    if (cores.length)
      facts.push([
        t3d(lang, 'info.cores'),
        `${used} ${t3d(lang, 'info.inUse')} · ${cores.length - used} ${t3d(lang, 'info.free')}`,
      ]);
    const rows: PortRow[] = cores.map((k) => {
      const free = k.status !== 'In Use';
      const a = k.assignments?.[k.assignments.length - 1];
      return {
        key: String(k.coreNumber),
        n: k.coreNumber,
        chip: k.colorName && k.colorHex ? { name: k.colorName, hex: k.colorHex } : undefined,
        state: free ? t3d(lang, 'info.freeOne') : t3d(lang, 'info.used'),
        free,
        text: free ? (k.status ?? '') : [a?.use, a?.destination].filter(Boolean).join(' → '),
      };
    });
    return { rec, facts, rows };
  }, [cableId, source, lang]);

  // Where a new connection can go: boxes with a free splitter output, for the PON being shown
  // (or all of them). A box belongs to a PON when a customer's recorded path through it does.
  const freePlaces = useMemo(() => {
    const ponKey = filter.kind === 'pon' ? filter.ponKey : null;
    const onPon = ponKey
      ? new Set(
          scene.customers
            .filter((c) => c.ponKey === ponKey)
            .flatMap((c) => c.hops.flatMap((h) => (h.kind === 'splitter' && h.boxId ? [h.boxId] : []))),
        )
      : null;
    return scene.boxes
      .filter((b) => (b.freeOutputs ?? 0) > 0 && (!onPon || onPon.has(b.id)))
      .map((b) => ({
        id: b.id,
        name: b.name,
        free: b.freeOutputs ?? 0,
        total: b.totalOutputs ?? 0,
        ratio: b.splitters.map((s) => s.ratio).join(', '),
      }))
      .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
  }, [scene, filter]);
  const goToBox = (id: string) => {
    setCableId(null);
    setCustomerId(null);
    setEquipmentId(id);
    engine.current?.selectCustomer(null);
    engine.current?.focusEquipment(id);
    setPreset(null);
  };

  const back2d = () => {
    const ui = useUiStore.getState();
    const sel = ui.selectedObject;
    if (sel && !scene.isDemo) showOnMap(sel);
    else openView('map');
  };

  if (!supported) return <WebGLFallback lang={lang} onBack={() => openView('map')} />;

  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const capKey = `cap.${caption}` as Msg3DKey;

  return (
    <>
      <div className="relative flex-1 overflow-hidden" style={{ background: dark ? '#0b0f14' : '#cfdbe6' }}>
        {wizardPicking && !scene.isDemo && (
          <div
            role="status"
            className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-lg"
          >
            {t3d(lang, 'edit.pickHouse')}
            <button
              type="button"
              onClick={() => useUiStore.getState().setCustomerWizardPicking(false)}
              className="min-h-[36px] rounded-full bg-white/20 px-3 hover:bg-white/30"
            >
              {t3d(lang, 'edit.cancel')}
            </button>
          </div>
        )}
        <div ref={host} className="absolute inset-0" />

        {scene.isDemo && (
          <div
            role="status"
            className="absolute left-1/2 top-2 z-20 hidden -translate-x-1/2 rounded-full bg-amber-400 px-3 py-1 text-[12px] font-semibold text-amber-950 shadow md:block"
          >
            {t3d(lang, 'demoBanner')}
          </div>
        )}

        {/* Left: views and toggles */}
        <div
          className={`absolute left-2 right-2 top-2 z-10 max-w-[560px] p-2.5 md:right-auto ${viewsOpen ? 'md:w-[460px]' : 'md:w-auto'} ${panelClass(tone)}`}
        >
          {scene.isDemo && (
            <div className="mb-1.5 rounded-md bg-amber-400 px-2 py-1 text-[12px] font-semibold text-amber-950 md:hidden">
              {t3d(lang, 'demoBanner')}
            </div>
          )}
          <div className={`flex items-center justify-between gap-2 ${viewsOpen ? 'mb-1.5' : ''}`}>
            <button
              type="button"
              aria-expanded={viewsOpen}
              aria-label={t3d(lang, viewsOpen ? 'panel.hide' : 'panel.show')}
              onClick={() => setViewsOpen((o) => !o)}
              className="flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold"
            >
              {viewsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              <h1>{t3d(lang, 'title')}</h1>
            </button>
            {viewsOpen && (
              <div className="flex items-center">
                <button
                  type="button"
                  aria-expanded={optionsOpen}
                  onClick={() => setOptionsOpen((o) => !o)}
                  className="min-h-[44px] rounded-lg px-2 text-[12.5px] font-medium underline-offset-2 hover:underline"
                >
                  {t3d(lang, 'options')}
                </button>
                <HelpBubble tone={tone} text={t3d(lang, 'help.views')} label={t3d(lang, 'help')} />
              </div>
            )}
          </div>
          {viewsOpen && (
            <PresetPanel
              tone={tone}
              lang={lang}
              active={preset}
              available={(k) => presetAvailable(scene, k)}
              onPreset={onPreset}
            />
          )}
          <div className={`mt-1.5 flex-wrap items-center gap-1.5 ${viewsOpen && optionsOpen ? 'flex' : 'hidden'}`}>
            <Btn tone={tone} on={prefs.labels} onClick={() => prefs.set({ labels: !prefs.labels })}>
              {t3d(lang, 'labels')}
            </Btn>
            <Btn tone={tone} on={prefs.pulses} onClick={() => prefs.set({ pulses: !prefs.pulses })}>
              {t3d(lang, 'pulses')}
            </Btn>
            <label className="inline-flex items-center gap-1 text-[12px]">
              <span className={muted}>{t3d(lang, 'theme')}</span>
              <select
                value={prefs.theme}
                onChange={(e) => prefs.set({ theme: e.target.value as ThemeChoice })}
                className={`h-[44px] rounded-lg border px-1.5 text-[12.5px] ${dark ? 'border-white/15 bg-slate-900' : 'border-black/15 bg-white'}`}
              >
                {(['auto', 'light', 'dark'] as const).map((t) => (
                  <option key={t} value={t}>
                    {t3d(lang, `theme.${t}` as Msg3DKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1 text-[12px]">
              <span className={muted}>{t3d(lang, 'language')}</span>
              <select
                value={lang}
                onChange={(e) => prefs.set({ lang: e.target.value as Lang3D })}
                className={`h-[44px] rounded-lg border px-1.5 text-[12.5px] ${dark ? 'border-white/15 bg-slate-900' : 'border-black/15 bg-white'}`}
              >
                {LANGS_3D.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES_3D[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1 text-[12px]">
              <span className={muted}>{t3d(lang, 'ground')}</span>
              <select
                value={prefs.ground}
                onChange={(e) => prefs.set({ ground: e.target.value as GroundChoice })}
                className={`h-[44px] rounded-lg border px-1.5 text-[12.5px] ${dark ? 'border-white/15 bg-slate-900' : 'border-black/15 bg-white'}`}
              >
                {(['map', 'satellite', 'plain'] as const).map((g) => (
                  <option key={g} value={g}>
                    {t3d(lang, `ground.${g}` as Msg3DKey)}
                  </option>
                ))}
              </select>
            </label>
            {!scene.isDemo && (
              <label className="inline-flex items-center gap-1 text-[12px]">
                <span className={muted}>{t3d(lang, 'origin')}</span>
                <select
                  value={prefs.origin}
                  onChange={(e) => prefs.set({ origin: e.target.value as OriginChoice })}
                  className={`h-[44px] rounded-lg border px-1.5 text-[12.5px] ${dark ? 'border-white/15 bg-slate-900' : 'border-black/15 bg-white'}`}
                >
                  {(['olt', 'start', 'middle'] as const).map((o) => (
                    <option key={o} value={o} disabled={o === 'start' && !projectStart}>
                      {t3d(lang, `origin.${o}` as Msg3DKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Btn tone={tone} onClick={() => prefs.set({ tourDone: false })}>
              <span className="inline-flex items-center gap-1">
                <CircleHelp size={14} /> {t3d(lang, 'tour.start')}
              </span>
            </Btn>
            <Btn tone={tone} on={prefs.demo} onClick={() => prefs.set({ demo: !prefs.demo })}>
              {prefs.demo ? t3d(lang, 'demoBack') : t3d(lang, 'demoLoad')}
            </Btn>
          </div>
          {groundSource && (groundState === 'loading' || groundState === 'failed' || groundState === 'partial') && (
            <p role="status" className={`mt-1.5 text-[12px] ${groundState === 'loading' ? muted : 'text-amber-600'}`}>
              {t3d(lang, `ground.${groundState}` as Msg3DKey)}
            </p>
          )}
          {groundSource && scene.isDemo && groundState !== 'failed' && (
            <p className={`mt-1 text-[12px] ${muted}`}>{t3d(lang, 'ground.demo')}</p>
          )}
          {groundSource && (groundState === 'ready' || groundState === 'partial') && (
            <p className={`mt-1 text-[10.5px] md:hidden ${muted}`}>{attribution}</p>
          )}
        </div>

        {/* Right: fiber map, find a house, selection */}
        <div
          className={`absolute bottom-2 left-2 right-2 z-10 max-h-[46vh] overflow-y-auto p-2.5 md:bottom-auto md:left-auto md:top-2 md:max-h-[calc(100%-1rem)] ${panelOpen ? 'md:w-[340px]' : 'md:w-auto'} ${panelClass(tone)}`}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((o) => !o)}
              className="flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold"
            >
              <Layers size={16} /> {t3d(lang, 'fiberMap')}
              {panelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {panelOpen && <HelpBubble tone={tone} text={t3d(lang, 'help.map')} label={t3d(lang, 'help')} />}
          </div>
          {panelOpen && (
            <div className="space-y-3">
              {isEmpty ? (
                <div className="space-y-2 text-[13px]">
                  <div className="font-semibold">{t3d(lang, 'empty')}</div>
                  <p className={muted}>{t3d(lang, 'emptyBody')}</p>
                  <Btn tone={tone} onClick={() => prefs.set({ demo: true })}>
                    {t3d(lang, 'demoLoad')}
                  </Btn>
                </div>
              ) : (
                <NetworkSummary
                  tone={tone}
                  lang={lang}
                  facts={summaryFacts}
                  pons={scene.ponChips}
                  activePon={filter.kind === 'pon' ? filter.ponKey : null}
                  onPon={onPon}
                />
              )}
              {!isEmpty && (
                <MappingPanel
                  tone={tone}
                  lang={lang}
                  scene={scene}
                  pon={pon}
                  onPon={onPon}
                  filter={filter}
                  onFilter={onFilter}
                />
              )}
              {scene.customers.length > 0 && (
                <div className="flex items-start gap-1">
                  <div className="flex-1">
                    <FindHouse tone={tone} lang={lang} onFind={onFind} max={scene.customers.length} />
                  </div>
                  <HelpBubble tone={tone} text={t3d(lang, 'help.find')} label={t3d(lang, 'help')} />
                </div>
              )}
              {customer && (
                <CustomerCard
                  tone={tone}
                  lang={lang}
                  path={customer}
                  others={others}
                  facts={customerFacts}
                  actions={
                    scene.isDemo
                      ? undefined
                      : [
                          { label: t3d(lang, 'edit.open'), onClick: openTools },
                          { label: t3d(lang, 'sv.open'), onClick: openStreet },
                        ]
                  }
                  onOther={pickCustomer}
                  onClose={() => pickCustomer(null)}
                  onShow2d={scene.isDemo ? undefined : back2d}
                />
              )}
              {cableInfo && (
                <EquipmentCard
                  tone={tone}
                  lang={lang}
                  name={cableInfo.rec.name}
                  type={cableInfo.rec.type}
                  status={cableInfo.rec.status}
                  facts={cableInfo.facts}
                  rows={{ title: t3d(lang, 'info.cores'), items: cableInfo.rows }}
                  actions={
                    scene.isDemo
                      ? undefined
                      : [
                          { label: t3d(lang, 'edit.open'), onClick: openTools },
                          { label: t3d(lang, 'sv.open'), onClick: openStreet },
                        ]
                  }
                  onClose={() => setCableId(null)}
                />
              )}
              {!isEmpty && (
                <FreePlaces
                  tone={tone}
                  lang={lang}
                  title={filter.kind === 'pon' ? (pon?.label ?? '') : t3d(lang, 'info.allPons')}
                  places={freePlaces}
                  onGo={goToBox}
                />
              )}
              {equipmentInfo && (
                <EquipmentCard
                  tone={tone}
                  lang={lang}
                  name={equipmentInfo.rec.name}
                  type={equipmentInfo.rec.type}
                  status={equipmentInfo.rec.status}
                  box={equipmentInfo.box}
                  extra={equipmentInfo.extra}
                  facts={equipmentFacts?.facts}
                  warning={equipmentFacts?.warning}
                  rows={{ title: t3d(lang, 'info.outs'), items: outputRows }}
                  actions={
                    scene.isDemo
                      ? undefined
                      : [
                          ...(outputRows.some((r) => r.free)
                            ? [
                                {
                                  label: t3d(lang, 'edit.addHere'),
                                  primary: true,
                                  onClick: addCustomerHere,
                                },
                              ]
                            : []),
                          { label: t3d(lang, 'edit.open'), onClick: openTools },
                          { label: t3d(lang, 'sv.open'), onClick: openStreet },
                        ]
                  }
                  onClose={() => setEquipmentId(null)}
                  onShow2d={scene.isDemo ? undefined : back2d}
                />
              )}
              <div className="flex items-start gap-1">
                <div className="flex-1">
                  <Legend tone={tone} lang={lang} />
                </div>
                <HelpBubble tone={tone} text={t3d(lang, 'help.legend')} label={t3d(lang, 'help')} />
              </div>
              <Notes tone={tone} lang={lang} notes={scene.notes} />
            </div>
          )}
        </div>

        {/* Move-around buttons, for people who do not know the mouse or finger moves. */}
        <div
          className={`absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 p-1 md:bottom-8 md:top-auto md:translate-y-0 ${panelOpen ? 'md:right-[356px]' : ''} ${panelClass(tone)}`}
        >
          {(
            [
              ['in', 'nav.in', <Plus key="i" size={20} />],
              ['out', 'nav.out', <Minus key="o" size={20} />],
              ['left', 'nav.left', <RotateCcw key="l" size={18} />],
              ['right', 'nav.right', <RotateCw key="r" size={18} />],
            ] as const
          ).map(([action, key, icon]) => (
            <button
              key={action}
              type="button"
              title={t3d(lang, key)}
              aria-label={t3d(lang, key)}
              onClick={() => engine.current?.nav(action)}
              className={`grid h-11 w-11 place-items-center rounded-lg ${dark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            >
              {icon}
            </button>
          ))}
          {!scene.isDemo && (
            <button
              type="button"
              title={t3d(lang, 'sv.open')}
              aria-label={t3d(lang, 'sv.open')}
              onClick={openStreet}
              className={`grid h-11 w-11 place-items-center rounded-lg ${dark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            >
              <PersonStanding size={20} />
            </button>
          )}
          <button
            type="button"
            title={t3d(lang, 'nav.home')}
            aria-label={t3d(lang, 'nav.home')}
            onClick={() => onPreset('ov')}
            className={`grid h-11 w-11 place-items-center rounded-lg ${dark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
          >
            <Home size={18} />
          </button>
        </div>

        {/* Caption: what this view shows, in plain words. Hidden on phones to keep the scene visible. */}
        <div
          className={`absolute bottom-2 left-2 z-10 hidden max-w-[440px] p-2.5 text-[12.5px] leading-snug md:block ${panelClass(tone)} ${muted}`}
          aria-live="polite"
        >
          {t3d(lang, capKey)}
        </div>

        {groundSource && (groundState === 'ready' || groundState === 'partial') && (
          <div className="pointer-events-none absolute bottom-1 right-16 z-10 hidden rounded bg-white/70 px-1.5 text-[10.5px] text-slate-700 md:block">
            {attribution}
          </div>
        )}

        {street && !scene.isDemo && (
          <StreetViewPanel
            tone={tone}
            lang={lang}
            at={street.at}
            markers={street.markers}
            onClose={() => setStreet(null)}
          />
        )}

        {!prefs.tourDone && <OnboardingTour tone={tone} lang={lang} onClose={() => prefs.set({ tourDone: true })} />}
      </div>
      {inspectorOpen && !scene.isDemo && <PropertiesPanel />}
    </>
  );
}
