import type { Cable, Customer, Equipment, Splitter } from '@fibergis/shared';
import { GUIDE_TOURS, type GuideTourId } from '@fibergis/shared';

import type { MapTool } from '../../stores/mapStore';
import type { ModalId } from '../../stores/uiStore';

/**
 * The two on-screen guides (learning assistant, Stage 3). Words and voice for a step come from its
 * lesson script (`@fibergis/shared` voiceLessons); this file says what each step shows and, for a
 * hands-on step, how the guide knows the person has done it, so it can move on by itself.
 *
 * - The menu tour opens each page (or its window) in turn and explains it. It changes nothing.
 * - The mapping guide waits while the person really places the OLT, FDT and FAT, draws the feeder
 *   and distribution cables, adds the FDT's splitter and adds the customer. What they make is saved
 *   on the real map like any other work (Undo takes it back). The guide itself never presses a
 *   button, never saves, and only moves the map so the next item is on screen.
 */

/** A real element on screen: a CSS selector, or the words a button or label starts with. */
export type GuideTarget =
  | { css: string }
  | {
      text: string;
      /** Elements to look in; defaults to buttons and labels. */
      tags?: string;
      /** Light up this ancestor of the found element instead (for example the field around a label). */
      up?: string;
    };

/** What the mapping guide has seen the person make, and what was on the map when it started. */
export interface GuideCtx {
  baseline: { equipment: string[]; cables: string[]; customers: string[]; splitters: string[] };
  olt?: string;
  fdt?: string;
  fat?: string;
  feeder?: string;
  dist?: string;
  fdtSplitter?: string;
  customer?: string;
  /** Demo, the full flow: the ODF, the poles the feeder hangs on, the FAT's splitter. */
  odf?: string;
  poles?: string[];
  fatSplitter?: string;
  /** Demo: which links are recorded so far (read from the records, never assumed). */
  odfPanel?: boolean;
  odfPatched?: boolean;
  odfFed?: boolean;
  fdtOut?: boolean;
}

/** Everything a step's check looks at. */
export interface GuideWorld {
  ctx: GuideCtx;
  map: { activeTool: MapTool; drawTarget: string; equipmentTypeToAdd: string | null };
  modals: Partial<Record<ModalId, boolean>>;
  selected: { type: string; id: string } | null;
  /** When the step began, in ms. */
  enteredAt: number;
}

export interface GuideStep {
  key: string;
  /** say: explain, then go on when the voice ends. do: wait until the person has done it. */
  kind: 'say' | 'do';
  /** Tried in order; the first one on screen is lit up. */
  targets?: GuideTarget[] | ((ctx: GuideCtx) => GuideTarget[]);
  /** Equipment pictures (the app's own drawings) shown on the card. */
  pictures?: string[];
  /** Menu tour: the page to open for this step. */
  route?: string;
  /** Menu tour: a window to open for this step (closed again after). */
  modal?: ModalId;
  /** Done yet? Hands-on steps only. */
  done?: (w: GuideWorld) => boolean;
  /** The person taps the map itself: no darkening, and the card keeps out of the way. */
  mapTap?: boolean;
  /** Move the map (the view only) so this new item is on screen when it is not. */
  bringIntoView?: 'olt' | 'odf' | 'fdt' | 'fat' | 'customer';
}

const EQUIPMENT_BUTTON: GuideTarget = { css: 'button[aria-label="Equipment"]' };
const DIALOG: GuideTarget = { css: '[role="dialog"]' };
/** Windows that draw their own frame instead of the shared one. */
const WINDOW: GuideTarget = { css: '.fixed.inset-0 > .shadow-2xl' };
const pin = (id?: string): GuideTarget[] => (id ? [{ css: `.gis-pin[data-eqid="${CSS.escape(id)}"]` }] : []);
const sidebar = (label: string): GuideTarget[] => [
  { css: `nav[aria-label="Primary"] [aria-label="${label}"]` },
  { text: label, tags: 'nav[aria-label="Primary"] a, nav[aria-label="Primary"] button, aside a, aside button' },
];

/* ---------------------------------------------------------------- checks */

/** The Equipment list is open (its search box shows), whichever entry is scrolled into view. */
const listOpen = () => !!findTarget({ css: 'input[placeholder^="Search OLT"]' });
const armed = (w: GuideWorld, type: string) =>
  w.map.activeTool === 'add_equipment' && w.map.equipmentTypeToAdd === type;
const drawingCable = (w: GuideWorld) => w.map.activeTool === 'draw_cable' && w.map.drawTarget === 'cable';
const saveCableOpen = (w: GuideWorld) => !!w.modals.cableWizard;
/** Which page of the Save Cable window is showing (Kind, Fibres, Ends, Route, Poles, Slack, Check). */
const CABLE_PAGES = ['type', 'cores', 'ends', 'route', 'support', 'slack', 'check'];
const cablePage = () => {
  const tab = document.querySelector<HTMLElement>('[data-testid^="cable-step-"][aria-current="step"]');
  return tab ? CABLE_PAGES.indexOf(tab.dataset.testid!.slice('cable-step-'.length)) : -1;
};
const ENDS_PAGE = CABLE_PAGES.indexOf('ends');
const LINE_TOUCHES: GuideTarget = { text: 'Your line touches', tags: 'p', up: 'div' };
const SAVE_CABLE_BUTTON: GuideTarget = { text: 'Save Cable', tags: 'button' };
const NEXT_BUTTON: GuideTarget = { css: '[data-testid="cable-step-next"]' };
/** In the Add customer window: an output port is picked (it shows ringed in its own box). */
const portChosen = () => {
  const label = formLabel('Select Available Output Port');
  return !!label?.parentElement?.querySelector('button.ring-2');
};
const isSelected = (w: GuideWorld, id?: string) => !!id && w.selected?.id === id;
/**
 * A label in the open Add customer window, even when the form is scrolled so it is out of sight
 * (the checks read the form; they do not need to see it).
 */
const formLabel = (text: string) =>
  [...document.querySelectorAll('label')].find(
    (l) => !l.closest('[data-guide-layer]') && (l.textContent ?? '').trim().startsWith(text),
  ) ?? null;
/** The value of the form field under a label, in the open Add customer window. */
function fieldValue(label: string): string {
  const el = formLabel(label);
  const control = el?.parentElement?.querySelector<HTMLInputElement | HTMLSelectElement>('select, input');
  return control?.value?.trim() ?? '';
}

const MENU: Record<string, Omit<GuideStep, 'key' | 'kind'>> = {
  'menu.intro': { route: '/' },
  'menu.map': { route: '/', targets: sidebar('Network Map') },
  'menu.view3d': { route: '/3d', targets: sidebar('3D View') },
  'menu.twin': { route: '/twin', targets: sidebar('Digital Twin') },
  'menu.equipment': { route: '/equipment', targets: sidebar('Equipment') },
  'menu.cables': { route: '/cables', targets: sidebar('Cables') },
  'menu.customers': { route: '/customers', targets: sidebar('Customers') },
  // The windows below are drawn on the map page, so these steps open it first.
  // Field capture is its own full-screen app for phones, so the guide shows where it is, not inside it.
  'menu.capture': { targets: sidebar('Field capture'), pictures: ['Telecom Pole', 'FAT', 'Optical Instrument'] },
  'menu.operations': { route: '/operations', targets: sidebar('Operations') },
  'menu.field': { route: '/field-work', targets: sidebar('Field Work') },
  'menu.agent': { route: '/agent-tracking', targets: sidebar('Agent Tracking') },
  'menu.onuFleet': { route: '/', modal: 'onuFleet', targets: [DIALOG, WINDOW, ...sidebar('ONU Fleet')] },
  'menu.trace': { route: '/', modal: 'fiberTrace', targets: [DIALOG, WINDOW, ...sidebar('Route Trace')] },
  'menu.boxes': { route: '/', modal: 'terminalBox', targets: [DIALOG, WINDOW, ...sidebar('Terminal Boxes')] },
  'menu.live': { route: '/', modal: 'monitoring', targets: [DIALOG, WINDOW, ...sidebar('Live status')] },
  'menu.knowledge': { route: '/', modal: 'knowledge', targets: [DIALOG, WINDOW, ...sidebar('Equipment Guide')] },
  'menu.admin': { route: '/admin', targets: sidebar('Administration') },
  'menu.done': { route: '/' },
};

const MAP: Record<string, Omit<GuideStep, 'key'>> = {
  'map.intro': { kind: 'say', pictures: ['OLT', 'FDT', 'FAT', 'ONT'] },

  'map.oltList': {
    kind: 'do',
    targets: [EQUIPMENT_BUTTON],
    pictures: ['OLT'],
    done: (w) => listOpen() || armed(w, 'OLT') || !!w.ctx.olt,
  },
  'map.oltPick': {
    kind: 'do',
    targets: [{ text: 'Optical Line Terminal (OLT)' }, EQUIPMENT_BUTTON],
    pictures: ['OLT'],
    done: (w) => armed(w, 'OLT') || !!w.ctx.olt,
  },
  // Tapping the map opens the OLT's setup window; the OLT is saved when that window is saved.
  'map.oltPlace': { kind: 'do', mapTap: true, pictures: ['OLT'], done: (w) => !!w.modals.oltConfig || !!w.ctx.olt },
  'map.oltSetup': {
    kind: 'do',
    targets: [DIALOG, WINDOW],
    pictures: ['OLT'],
    // Done once the OLT is saved and its setup window is closed.
    done: (w) => !!w.ctx.olt && !w.modals.oltConfig,
  },

  'map.fdtList': {
    kind: 'do',
    targets: [EQUIPMENT_BUTTON],
    pictures: ['FDT'],
    done: (w) => listOpen() || armed(w, 'FDT') || !!w.ctx.fdt,
  },
  'map.fdtPick': {
    kind: 'do',
    targets: [{ text: 'Fiber Distribution Terminal (FDT)' }, EQUIPMENT_BUTTON],
    pictures: ['FDT'],
    done: (w) => armed(w, 'FDT') || !!w.ctx.fdt,
  },
  'map.fdtPlace': { kind: 'do', mapTap: true, pictures: ['FDT'], done: (w) => !!w.ctx.fdt },

  'map.feederSelect': {
    kind: 'do',
    targets: (ctx) => pin(ctx.olt),
    bringIntoView: 'olt',
    pictures: ['OLT', 'FDT'],
    done: (w) =>
      isSelected(w, w.ctx.olt) ||
      !!findTarget({ text: 'Draw feeder cable' }) ||
      drawingCable(w) ||
      saveCableOpen(w) ||
      !!w.ctx.feeder,
  },
  'map.feederStart': {
    kind: 'do',
    targets: [{ text: 'Draw feeder cable' }],
    done: (w) => drawingCable(w) || saveCableOpen(w) || !!w.ctx.feeder,
  },
  'map.feederRoute': {
    kind: 'do',
    mapTap: true,
    pictures: ['OLT', 'FDT'],
    done: (w) => saveCableOpen(w) || !!w.ctx.feeder,
  },
  'map.feederKind': {
    kind: 'do',
    targets: [NEXT_BUTTON, DIALOG, WINDOW],
    done: (w) => cablePage() >= ENDS_PAGE || !!w.ctx.feeder,
  },
  'map.feederEnds': {
    kind: 'do',
    targets: [LINE_TOUCHES, NEXT_BUTTON, WINDOW],
    pictures: ['OLT', 'FDT'],
    done: (w) => cablePage() > ENDS_PAGE || !!w.ctx.feeder,
  },
  'map.feederSave': {
    kind: 'do',
    targets: [SAVE_CABLE_BUTTON, NEXT_BUTTON, WINDOW],
    done: (w) => !!w.ctx.feeder && !saveCableOpen(w),
  },
  // Saving a cable leaves the drawing tool on: the next tap on the map would start another cable.
  'map.feederStop': {
    kind: 'do',
    targets: [{ css: 'button[aria-label="Select"]' }],
    done: (w) => w.map.activeTool !== 'draw_cable',
  },

  'map.fdtSplitterOpen': {
    kind: 'do',
    targets: (ctx) => pin(ctx.fdt),
    bringIntoView: 'fdt',
    pictures: ['FDT', 'Fiber Splitter'],
    done: (w) => isSelected(w, w.ctx.fdt) || !!w.ctx.fdtSplitter,
  },
  'map.fdtSplitterAdd': {
    kind: 'do',
    targets: [
      { text: 'Add a splitter', tags: 'p', up: 'div' },
      { text: 'Connectivity', tags: 'button' },
    ],
    pictures: ['Fiber Splitter'],
    done: (w) => !!w.ctx.fdtSplitter,
  },

  'map.fatList': {
    kind: 'do',
    targets: [EQUIPMENT_BUTTON],
    pictures: ['FAT'],
    done: (w) => listOpen() || armed(w, 'FAT') || !!w.ctx.fat,
  },
  'map.fatPick': {
    kind: 'do',
    targets: [{ text: 'FAT Terminal Box' }, EQUIPMENT_BUTTON],
    pictures: ['FAT'],
    done: (w) => armed(w, 'FAT') || !!w.ctx.fat,
  },
  'map.fatPlace': { kind: 'do', mapTap: true, pictures: ['FAT'], done: (w) => !!w.ctx.fat },

  'map.distSelect': {
    kind: 'do',
    targets: (ctx) => pin(ctx.fdt),
    bringIntoView: 'fdt',
    pictures: ['FDT', 'FAT'],
    done: (w) => isSelected(w, w.ctx.fdt) || drawingCable(w) || saveCableOpen(w) || !!w.ctx.dist,
  },
  'map.distStart': {
    kind: 'do',
    targets: [{ text: 'Start cable here' }, { text: 'Details', tags: 'button, [role="tab"]' }],
    done: (w) => drawingCable(w) || saveCableOpen(w) || !!w.ctx.dist,
  },
  'map.distRoute': {
    kind: 'do',
    mapTap: true,
    pictures: ['FDT', 'FAT'],
    done: (w) => saveCableOpen(w) || !!w.ctx.dist,
  },
  'map.distKind': {
    kind: 'do',
    targets: [NEXT_BUTTON, DIALOG, WINDOW],
    done: (w) => cablePage() >= ENDS_PAGE || !!w.ctx.dist,
  },
  'map.distEnds': {
    kind: 'do',
    targets: [LINE_TOUCHES, NEXT_BUTTON, WINDOW],
    pictures: ['FDT', 'FAT'],
    done: (w) => cablePage() > ENDS_PAGE || !!w.ctx.dist,
  },
  'map.distSave': {
    kind: 'do',
    targets: [SAVE_CABLE_BUTTON, NEXT_BUTTON, WINDOW],
    done: (w) => !!w.ctx.dist && !saveCableOpen(w),
  },
  // Saving a cable leaves the drawing tool on: the next tap on the map would start another cable.
  'map.distStop': {
    kind: 'do',
    targets: [{ css: 'button[aria-label="Select"]' }],
    done: (w) => w.map.activeTool !== 'draw_cable',
  },

  'map.custOpen': {
    kind: 'do',
    targets: [{ css: 'button[aria-label="Add customer"]' }],
    pictures: ['FAT', 'ONT'],
    done: (w) => !!w.modals.customerWizard || !!w.ctx.customer,
  },
  'map.custBox': {
    kind: 'do',
    targets: [{ text: 'Access Terminal (FAT)', tags: 'label', up: 'div' }],
    pictures: ['FAT'],
    done: (w) => fieldValue('Access Terminal (FAT)') !== '' || !!w.ctx.customer,
  },
  // A new box has no splitter: the form offers one, and Activate stays off until it is added.
  'map.custSplitter': {
    kind: 'do',
    targets: [
      { text: 'Add splitter', tags: 'button' },
      { text: 'Splitter Module', tags: 'label', up: 'div' },
    ],
    pictures: ['Fiber Splitter'],
    // Done once a splitter is chosen: its output ports then show.
    done: (w) => !!formLabel('Select Available Output Port') || !!w.ctx.customer,
  },
  // The person taps the output port; the form never picks one, and Activate stays off until then.
  'map.custPort': {
    kind: 'do',
    targets: [{ text: 'Select Available Output Port', tags: 'label', up: 'div' }],
    pictures: ['FAT'],
    // Done once a port and the drop fiber are chosen (both buttons show as pressed or picked).
    done: (w) =>
      (portChosen() && !!document.querySelector('[aria-label="Drop fiber"] [aria-pressed="true"]')) || !!w.ctx.customer,
  },
  'map.custPlace': {
    kind: 'do',
    targets: [{ text: 'Use my GPS' }],
    pictures: ['Customer Terminal'],
    done: (w) => fieldValue('Latitude') !== '' || !!w.ctx.customer,
  },
  'map.custSave': {
    kind: 'do',
    // The "Save with missing details?" question, when it opens, is lit up instead.
    targets: [{ text: 'Save anyway', tags: 'button' }, { text: 'Activate Subscriber' }],
    pictures: ['ONT'],
    done: (w) => !!w.ctx.customer && !w.modals.customerWizard,
  },
  'map.check': {
    kind: 'do',
    bringIntoView: 'customer',
    mapTap: true,
    pictures: ['OLT', 'FDT', 'FAT', 'ONT'],
    done: (w) => isSelected(w, w.ctx.customer),
  },
  'map.done': { kind: 'say', pictures: ['OLT', 'FDT', 'FAT', 'ONT'] },
};

const INSPECTOR: GuideTarget = { css: 'aside[aria-label="Inspector"]' };
/** A section of the open item's panel, lit up whole, found by its title. */
const section = (title: string): GuideTarget => ({ text: title, tags: 'section > button', up: 'section' });
const tabOpen = (label: string) =>
  !!findTarget({ css: `aside[aria-label="Inspector"] [role="tab"][aria-selected="true"]` })?.textContent?.startsWith(label);
/** Which page of the Save Cable window is showing, by its name. */
const onPage = (name: string) => cablePage() >= CABLE_PAGES.indexOf(name);

/**
 * The demo's full flow (`flow.*` lessons). From the ISP to the OLT and inside the house it only
 * explains, with pictures: the app does not record those links yet. From the OLT to the FAT it
 * builds and connects on the real map, and explains each item's panel and buttons on the way.
 */
const FLOW: Record<string, Omit<GuideStep, 'key'>> = {
  'flow.isp': { kind: 'say', pictures: ['Router'] },
  'flow.edgeRouter': { kind: 'say', pictures: ['Router'] },
  'flow.bng': { kind: 'say', pictures: ['MikroTik Router'] },
  'flow.coreRouter': { kind: 'say', pictures: ['Router'] },
  'flow.coreSwitch': { kind: 'say', pictures: ['Core Switch'] },
  'flow.aggSwitch': { kind: 'say', pictures: ['Core Switch'] },
  'flow.uplink': { kind: 'say', pictures: ['Core Switch', 'OLT'] },

  'flow.oltPanel': {
    kind: 'say',
    targets: [INSPECTOR],
    pictures: ['OLT'],
  },
  'flow.oltConnect': {
    kind: 'do',
    targets: [{ text: 'Connectivity', tags: '[role="tab"]' }],
    pictures: ['OLT'],
    done: () => tabOpen('Connectivity'),
  },
  'flow.chassis': { kind: 'say', targets: [section('Chassis'), INSPECTOR], pictures: ['OLT'] },
  'flow.uplinkPort': { kind: 'say', targets: [section('Chassis'), INSPECTOR], pictures: ['OLT', 'Core Switch'] },
  'flow.ponPort': { kind: 'say', targets: [section('PON ports'), INSPECTOR], pictures: ['OLT'] },

  'flow.odfList': {
    kind: 'do',
    targets: [EQUIPMENT_BUTTON],
    pictures: ['ODF'],
    done: (w) => listOpen() || armed(w, 'ODF') || !!w.ctx.odf,
  },
  'flow.odfPick': {
    kind: 'do',
    targets: [{ text: 'Optical Distribution Frame (ODF)' }, EQUIPMENT_BUTTON],
    pictures: ['ODF'],
    done: (w) => armed(w, 'ODF') || !!w.ctx.odf,
  },
  'flow.odfPlace': { kind: 'do', mapTap: true, pictures: ['ODF'], done: (w) => !!w.ctx.odf },
  'flow.odfPanel': {
    kind: 'do',
    targets: [section('ODF panels'), INSPECTOR],
    pictures: ['ODF'],
    done: (w) => !!w.ctx.odfPanel,
  },
  'flow.odfPatch': {
    kind: 'do',
    targets: [section('ODF panels'), INSPECTOR],
    pictures: ['OLT', 'ODF'],
    done: (w) => !!w.ctx.odfPatched,
  },
  'flow.odfButtons': {
    kind: 'say',
    targets: [{ css: '[data-testid="odf-port-detail"]' }, section('ODF panels')],
    pictures: ['ODF'],
  },

  'flow.feederSelect': {
    kind: 'do',
    targets: (ctx) => pin(ctx.odf),
    bringIntoView: 'odf',
    pictures: ['ODF', 'FDT'],
    done: (w) => isSelected(w, w.ctx.odf) || drawingCable(w) || saveCableOpen(w) || !!w.ctx.feeder,
  },
  'flow.feederStart': {
    kind: 'do',
    targets: [{ text: 'Start cable here' }, { text: 'Details', tags: 'button, [role="tab"]' }],
    done: (w) => drawingCable(w) || saveCableOpen(w) || !!w.ctx.feeder,
  },
  'flow.feederRoute': {
    kind: 'do',
    mapTap: true,
    pictures: ['ODF', 'Telecom Pole', 'FDT'],
    done: (w) => saveCableOpen(w) || !!w.ctx.feeder,
  },
  'flow.feederKind': {
    kind: 'do',
    targets: [NEXT_BUTTON, DIALOG, WINDOW],
    done: (w) => cablePage() >= ENDS_PAGE || !!w.ctx.feeder,
  },
  'flow.feederEnds': {
    kind: 'do',
    targets: [LINE_TOUCHES, NEXT_BUTTON, WINDOW],
    pictures: ['ODF', 'FDT'],
    done: (w) => cablePage() > ENDS_PAGE || !!w.ctx.feeder,
  },
  'flow.feederPoles': {
    kind: 'do',
    targets: [{ text: 'Poles near the line', tags: 'legend', up: 'fieldset' }, NEXT_BUTTON, WINDOW],
    pictures: ['Telecom Pole'],
    done: (w) => onPage('slack') || !!w.ctx.feeder,
  },
  'flow.feederSlack': {
    kind: 'do',
    targets: [{ text: 'Add a slack loop', tags: 'button' }, NEXT_BUTTON, WINDOW],
    pictures: ['Fiber Slack Loop'],
    done: (w) => onPage('check') || !!w.ctx.feeder,
  },
  'flow.feederSave': {
    kind: 'do',
    targets: [SAVE_CABLE_BUTTON, NEXT_BUTTON, WINDOW],
    done: (w) => !!w.ctx.feeder && !saveCableOpen(w),
  },
  'flow.feederStop': {
    kind: 'do',
    targets: [{ css: 'button[aria-label="Select"]' }],
    done: (w) => w.map.activeTool !== 'draw_cable',
  },
  'flow.ducts': { kind: 'say', pictures: ['Manhole', 'Handhole', 'Duct', 'Underground Chamber'] },

  'flow.odfFeeder': {
    kind: 'do',
    targets: (ctx) => [section('ODF panels'), ...pin(ctx.odf)],
    bringIntoView: 'odf',
    pictures: ['ODF', 'Fiber Splice Joint'],
    done: (w) => !!w.ctx.odfFed,
  },
  'flow.fusion': { kind: 'say', pictures: ['Fiber Splice Joint'] },
  'flow.closure': { kind: 'say', pictures: ['Fiber Joint Closure', 'Fiber Splice Joint'] },

  'flow.fdtOpen': {
    kind: 'do',
    targets: (ctx) => pin(ctx.fdt),
    bringIntoView: 'fdt',
    pictures: ['FDT'],
    done: (w) => isSelected(w, w.ctx.fdt) || !!w.ctx.fdtSplitter,
  },
  'flow.fdtSplitter': {
    kind: 'do',
    targets: [section('Splitters and ports'), { text: 'Connectivity', tags: '[role="tab"]' }],
    pictures: ['FDT', 'Fiber Splitter'],
    done: (w) => !!w.ctx.fdtSplitter,
  },
  'flow.fdtButtons': { kind: 'say', targets: [section('Splitters and ports'), INSPECTOR], pictures: ['Fiber Splitter'] },

  'flow.fdtOutput': {
    kind: 'do',
    targets: (ctx) => [section('Splitters and ports'), ...pin(ctx.fdt)],
    bringIntoView: 'fdt',
    pictures: ['Fiber Splitter', 'FAT'],
    done: (w) => !!w.ctx.fdtOut,
  },
  'flow.intermediate': { kind: 'say', pictures: ['Fiber Joint Closure', 'Fiber Splitter'] },
  'flow.fatOpen': {
    kind: 'do',
    targets: (ctx) => pin(ctx.fat),
    bringIntoView: 'fat',
    pictures: ['FAT'],
    done: (w) => isSelected(w, w.ctx.fat) || !!w.ctx.fatSplitter,
  },
  'flow.fatSplitter': {
    kind: 'do',
    targets: [section('Splitters and ports'), { text: 'Connectivity', tags: '[role="tab"]' }],
    pictures: ['FAT', 'Fiber Splitter'],
    done: (w) => !!w.ctx.fatSplitter,
  },
  'flow.fatButtons': { kind: 'say', targets: [section('Splitters and ports'), INSPECTOR], pictures: ['FAT'] },

  'flow.drop': { kind: 'say', pictures: ['FAT', 'Building Entry Point'] },
  'flow.rosette': { kind: 'say', pictures: ['Customer Terminal', 'Fiber Connector'] },
  'flow.ont': { kind: 'say', pictures: ['ONT', 'ONU'] },
  'flow.lan': { kind: 'say', pictures: ['ONT', 'Wi-Fi Router'] },
};

/** Steps only the self-running demo has: it never saves a customer, and removes what it made. */
const DEMO: Record<string, Omit<GuideStep, 'key'>> = {
  'demo.intro': { kind: 'say', pictures: ['OLT', 'FDT', 'FAT', 'ONT'] },
  'demo.custSave': {
    kind: 'do',
    targets: [{ text: 'Activate Subscriber' }],
    pictures: ['ONT'],
    done: (w) => !w.modals.customerWizard,
  },
  ...FLOW,
  'demo.cleanup': {
    kind: 'do',
    pictures: ['OLT', 'ODF', 'FDT', 'FAT'],
    done: (w) =>
      !w.ctx.olt && !w.ctx.odf && !w.ctx.fdt && !w.ctx.fat && !w.ctx.feeder && !w.ctx.dist && !w.ctx.poles?.length,
  },
  'demo.done': { kind: 'say', pictures: ['OLT', 'FDT', 'FAT', 'ONT'] },
};

export function guideSteps(tour: GuideTourId): GuideStep[] {
  if (tour === 'menu') return GUIDE_TOURS.menu.map((key) => ({ key, kind: 'say' as const, ...MENU[key] }));
  if (tour === 'demo') return GUIDE_TOURS.demo.map((key) => ({ key, ...(DEMO[key] ?? MAP[key]) }));
  return GUIDE_TOURS.map.map((key) => ({ key, ...MAP[key] }));
}

/** Every step the guide knows, so a test can check none is missing or left over. */
export const GUIDE_STEP_KEYS = [...Object.keys(MENU), ...Object.keys(MAP), ...Object.keys(DEMO)];

export const stepTargets = (step: GuideStep, ctx: GuideCtx): GuideTarget[] =>
  typeof step.targets === 'function' ? step.targets(ctx) : (step.targets ?? []);

/* -------------------------------------------- what the person has made */

interface NetworkParts {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  customers: readonly Customer[];
  splitters: readonly Splitter[];
}

export function startCtx(network: NetworkParts): GuideCtx {
  return {
    baseline: {
      equipment: network.equipment.map((e) => e.id),
      cables: network.cables.map((c) => c.id),
      customers: network.customers.map((c) => c.id),
      splitters: network.splitters.map((s) => s.id),
    },
  };
}

const FAT_TYPES = new Set(['FAT', 'Pole-Mounted Terminal Box']);
const CTX_KEYS = [
  'olt',
  'fdt',
  'fat',
  'feeder',
  'dist',
  'fdtSplitter',
  'customer',
  'odf',
  'fatSplitter',
  'odfPanel',
  'odfPatched',
  'odfFed',
  'fdtOut',
] as const;
const POLE_TYPES = new Set(['Telecom Pole', 'Electric Pole']);

/**
 * Notes the new OLT, FDT, FAT, cables, splitter and customer the person made since the guide
 * started. An item that was undone or deleted is forgotten again, so its step waits once more.
 * `madeHere` says whether a record was created on this device: records the server sends while the
 * map moves (map areas load as they come into view) are not in the baseline, but they were not made
 * during the guide, so they never count. Returns the same object when nothing changed.
 */
export function updateCtx(
  ctx: GuideCtx,
  network: NetworkParts,
  madeHere: (id: string) => boolean = () => true,
): GuideCtx {
  const baseEquipment = new Set(ctx.baseline.equipment);
  const baseCables = new Set(ctx.baseline.cables);
  const baseCustomers = new Set(ctx.baseline.customers);
  const has = (ids: Iterable<{ id: string }>) => new Set([...ids].map((x) => x.id));
  const equipmentIds = has(network.equipment);
  const cableIds = has(network.cables);
  const keep = (id: string | undefined, ids: Set<string>) => (id && ids.has(id) ? id : undefined);
  const next: GuideCtx = {
    baseline: ctx.baseline,
    olt: keep(ctx.olt, equipmentIds),
    fdt: keep(ctx.fdt, equipmentIds),
    fat: keep(ctx.fat, equipmentIds),
    feeder: keep(ctx.feeder, cableIds),
    dist: keep(ctx.dist, cableIds),
    fdtSplitter: keep(ctx.fdtSplitter, has(network.splitters)),
    customer: keep(ctx.customer, has(network.customers)),
    odf: keep(ctx.odf, equipmentIds),
    fatSplitter: keep(ctx.fatSplitter, has(network.splitters)),
  };
  const fresh = network.equipment.filter((e) => !baseEquipment.has(e.id) && madeHere(e.id));
  next.olt ??= fresh.find((e) => e.type === 'OLT')?.id;
  next.fdt ??= fresh.find((e) => e.type === 'FDT')?.id;
  next.fat ??= fresh.find((e) => FAT_TYPES.has(e.type))?.id;
  // The first new street cable is the feeder, the next one the distribution cable. House wires are
  // made by Add customer and do not count.
  const newCables = network.cables.filter(
    (c) => !baseCables.has(c.id) && c.type !== 'Drop Fiber' && madeHere(c.id),
  );
  next.feeder ??= newCables.find((c) => c.id !== next.dist)?.id;
  if (next.feeder) next.dist ??= newCables.find((c) => c.id !== next.feeder)?.id;
  if (next.fdt) next.fdtSplitter ??= network.splitters.find((s) => s.terminalBoxId === next.fdt)?.id;
  next.customer ??= network.customers.find((c) => !baseCustomers.has(c.id) && madeHere(c.id))?.id;
  // The full-flow demo: the ODF, the poles placed while drawing the feeder, the FAT's splitter.
  next.odf ??= fresh.find((e) => e.type === 'ODF')?.id;
  const poles = fresh.filter((e) => POLE_TYPES.has(e.type)).map((e) => e.id);
  if (poles.length > 0) next.poles = poles;
  if (next.fat) next.fatSplitter ??= network.splitters.find((s) => s.terminalBoxId === next.fat)?.id;
  // Which links are recorded, read from the records.
  const odfPorts = network.equipment.find((e) => e.id === next.odf)?.odfPanels?.flatMap((p) => p.ports) ?? [];
  const flag = (yes: boolean) => (yes ? true : undefined);
  next.odfPanel = flag(odfPorts.length > 0);
  next.odfPatched = flag(!!next.olt && odfPorts.some((p) => p.patch?.oltId === next.olt));
  next.odfFed = flag(!!next.feeder && odfPorts.some((p) => p.feederCableId === next.feeder));
  const fdtSplitter = network.splitters.find((s) => s.id === next.fdtSplitter);
  next.fdtOut = flag(!!next.dist && !!fdtSplitter?.outputPorts.some((o) => o.connectedDropCableId === next.dist));
  const samePoles = (ctx.poles ?? []).join() === poles.join();
  return samePoles && CTX_KEYS.every((k) => next[k] === ctx[k]) ? ctx : next;
}

/* ------------------------------------------------- finding it on screen */

/** On screen, and not hidden under another panel (the guide's own layer does not count). */
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= 0.05) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
  const top = document.elementsFromPoint(x, y).find((hit) => !hit.closest('[data-guide-layer]'));
  return !top || el.contains(top) || top.contains(el);
};

/**
 * A button in a sideways-scrolling bar (the phone's map toolbar) that is scrolled out of sight:
 * scroll the bar so it shows. Nothing else is ever scrolled, so the map and page never move.
 */
export function scrollBarToTarget(target: GuideTarget) {
  if (!('css' in target)) {
    // An entry further down a list (the Equipment list): scroll that list, not the page or the map.
    const el = [...document.querySelectorAll<HTMLElement>(target.tags ?? 'button, label')].find(
      (e) => !e.closest('[data-guide-layer]') && (e.textContent ?? '').trim().startsWith(target.text),
    );
    const list = el?.parentElement?.closest<HTMLElement>('.overflow-y-auto');
    if (el && list && !el.closest('.leaflet-container')) {
      const r = el.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      if (r.top < l.top || r.bottom > l.bottom) list.scrollBy({ top: r.top - l.top - l.height / 3 });
    }
    return;
  }
  const el = [...document.querySelectorAll<HTMLElement>(target.css)].find((e) => !e.closest('[data-guide-layer]'));
  const bar = el?.parentElement?.closest<HTMLElement>('.overflow-x-auto');
  if (!el || !bar || bar.scrollWidth <= bar.clientWidth) return;
  const r = el.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  if (r.left >= b.left && r.right <= b.right) return;
  bar.scrollBy({ left: r.left + r.width / 2 - (b.left + b.width / 2) });
}

/** The real element a target means, if it is on screen now. Inside the guide itself is never chosen. */
export function findTarget(target: GuideTarget): HTMLElement | null {
  const outsideGuide = (el: Element) => !el.closest('[data-guide-layer]');
  if ('css' in target) {
    return (
      [...document.querySelectorAll<HTMLElement>(target.css)].find((el) => outsideGuide(el) && visible(el)) ?? null
    );
  }
  const candidates = [...document.querySelectorAll<HTMLElement>(target.tags ?? 'button, label')].filter(
    (el) => outsideGuide(el) && (el.textContent ?? '').trim().startsWith(target.text) && visible(el),
  );
  // The smallest match is the button itself rather than a panel around it.
  candidates.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
  const found = candidates[0];
  if (!found) return null;
  return target.up ? (found.parentElement?.closest<HTMLElement>(target.up) ?? found) : found;
}
