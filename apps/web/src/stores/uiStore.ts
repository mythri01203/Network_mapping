import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Cable, Customer, Equipment, Fault, JointClosure, UserRole } from '@fibergis/shared';

import { preferenceKey, preferenceStorage } from './persistStorage';

export type SelectedObject =
  | { type: 'equipment'; data: Equipment }
  | { type: 'cable'; data: Cable }
  | { type: 'customer'; data: Customer }
  | { type: 'closure'; data: JointClosure }
  | { type: 'fault'; data: Fault };
export type SelectedObjectType = SelectedObject['type'];

/** Human-readable label for a selection (faults are titled, everything else is named). */
export function selectionLabel(selection: SelectedObject): string {
  const label = selection.type === 'fault' ? selection.data.title : selection.data.name;
  return label || selection.data.id;
}

export const MODAL_IDS = [
  'cableWizard',
  'customerWizard',
  'equipment',
  'terminalBox',
  'splitter',
  'splicing',
  'routeTrace',
  'faults',
  'technicianMobile',
  'capacityDashboard',
  'reports',
  'help',
  'documents',
  'componentCatalog',
  'portManager',
  'knowledge',
  'spliceModal',
  'fiberTrace',
  'onuFleet',
  'oltConfig',
] as const;
export type ModalId = (typeof MODAL_IDS)[number];

export type PanelId = 'left' | 'right' | 'bottom';
export type UiMode = 'simple' | 'pro';
export type NetworkMode = 'All' | 'Fiber' | 'CableTV';

type Updater<T> = T | ((prev: T) => T);
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;

const closedModals = Object.fromEntries(MODAL_IDS.map((id) => [id, false])) as Record<ModalId, boolean>;

/** Maps an equipment type or id (e.g. "GPON OLT", "FAT-03") to its knowledge-base article key. */
export function knowledgeKeyFor(equipmentTypeOrId: string): string {
  const key = equipmentTypeOrId.toLowerCase().replace(/\s+/g, '-');
  const rules: [test: (k: string) => boolean, article: string][] = [
    [(k) => k.includes('gpon'), 'gpon-olt'],
    [(k) => k.includes('epon'), 'epon-olt'],
    [(k) => k.includes('olt'), 'olt'],
    [(k) => k.includes('odf'), 'odf'],
    [(k) => k.includes('fdms') || k.includes('distribution-cabinet'), 'fdms'],
    [(k) => k.includes('fat') || k.includes('terminal-box'), 'fat'],
    [(k) => k.includes('splitter') || k.includes('coupler'), 'splitter'],
    [(k) => k.includes('closure') || k.includes('joint') || k.includes('splice') || k.includes('connector'), 'joint-closure'],
    [(k) => k.includes('pole') || k.includes('loop'), 'telecom-pole'],
    [(k) => k.includes('ont') || k.includes('onu') || k.includes('instrument'), 'ont'],
    [(k) => k.includes('mikrotik') || k.includes('microtek'), 'olt'],
    [(k) => k.includes('receiver') || k.includes('node') || k.includes('catv'), 'optical-receiver'],
  ];
  return rules.find(([test]) => test(key))?.[1] ?? key;
}

export interface UiState {
  selectedObject: SelectedObject | null;
  modals: Record<ModalId, boolean>;
  panels: Record<PanelId, boolean>;
  isSidebarCollapsed: boolean;
  selectedKnowledgeId: string | null;
  selectedSpliceTarget: Equipment | Customer | null;
  activeTraceTargetId: string | null;
  pickingOnuCustomer: Customer | null;
  /** The customer form is hidden while the person taps the house on the map. */
  customerWizardPicking: boolean;
  customerWizardPick: { lat: number; lng: number } | null;
  /** The navigation menu shown over the screen on phones. */
  isMobileMenuOpen: boolean;
  selectedOltForConfig: Equipment | null;
  // Preferences (persisted)
  uiMode: UiMode;
  userRole: UserRole;
  networkMode: NetworkMode;

  select: (selection: SelectedObject | null) => void;
  setModalOpen: (id: ModalId, open: boolean) => void;
  setPanelOpen: (id: PanelId, open: Updater<boolean>) => void;
  setSidebarCollapsed: (collapsed: Updater<boolean>) => void;
  setSelectedKnowledgeId: (id: string | null) => void;
  setSelectedSpliceTarget: (target: Equipment | Customer | null) => void;
  openSpliceModal: (target: Equipment | Customer) => void;
  setActiveTraceTargetId: (id: string | null) => void;
  openFiberTrace: (targetId: string) => void;
  openOltConfigModal: (olt: Equipment) => void;
  closeOltConfigModal: () => void;
  setPickingOnuCustomer: (customer: Customer | null) => void;
  setCustomerWizardPicking: (picking: boolean) => void;
  setCustomerWizardPick: (pick: { lat: number; lng: number } | null) => void;
  setMobileMenuOpen: (open: boolean) => void;
  openKnowledge: (equipmentTypeOrId: string) => void;
  setUiMode: (mode: UiMode) => void;
  setUserRole: (role: UserRole) => void;
  setNetworkMode: (mode: NetworkMode) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedObject: null,
      modals: closedModals,
      // Start uncluttered: maximum map space, panels open on demand.
      panels: { left: false, right: false, bottom: false },
      isSidebarCollapsed: true,
      selectedKnowledgeId: null,
      selectedSpliceTarget: null,
      activeTraceTargetId: null,
      pickingOnuCustomer: null,
      customerWizardPicking: false,
      customerWizardPick: null,
      isMobileMenuOpen: false,
      selectedOltForConfig: null,
      uiMode: 'simple',
      userRole: 'Network Engineer',
      networkMode: 'All',

      select: (selectedObject) => set({ selectedObject }),
      setModalOpen: (id, open) => set((s) => (s.modals[id] === open ? s : { modals: { ...s.modals, [id]: open } })),
      setPanelOpen: (id, open) => set((s) => ({ panels: { ...s.panels, [id]: resolve(open, s.panels[id]) } })),
      setSidebarCollapsed: (collapsed) =>
        set((s) => ({ isSidebarCollapsed: resolve(collapsed, s.isSidebarCollapsed) })),
      setSelectedKnowledgeId: (selectedKnowledgeId) => set({ selectedKnowledgeId }),
      setSelectedSpliceTarget: (selectedSpliceTarget) => set({ selectedSpliceTarget }),
      openSpliceModal: (target) =>
        set((s) => ({
          selectedSpliceTarget: target,
          modals: { ...s.modals, spliceModal: true },
        })),
      setActiveTraceTargetId: (activeTraceTargetId) => set({ activeTraceTargetId }),
      openFiberTrace: (targetId) =>
        set((s) => ({
          activeTraceTargetId: targetId,
          modals: { ...s.modals, fiberTrace: true },
        })),
      openOltConfigModal: (olt) =>
        set((s) => ({
          selectedOltForConfig: olt,
          modals: { ...s.modals, oltConfig: true },
        })),
      closeOltConfigModal: () =>
        set((s) => ({
          selectedOltForConfig: null,
          modals: { ...s.modals, oltConfig: false },
        })),
      setPickingOnuCustomer: (pickingOnuCustomer) => set({ pickingOnuCustomer }),
      setCustomerWizardPicking: (customerWizardPicking) => set({ customerWizardPicking }),
      setCustomerWizardPick: (customerWizardPick) => set({ customerWizardPick, customerWizardPicking: false }),
      setMobileMenuOpen: (isMobileMenuOpen) => set({ isMobileMenuOpen }),
      openKnowledge: (equipmentTypeOrId) =>
        set((s) => ({
          selectedKnowledgeId: knowledgeKeyFor(equipmentTypeOrId),
          modals: { ...s.modals, knowledge: true },
        })),
      setUiMode: (uiMode) => set({ uiMode }),
      setUserRole: (userRole) => set({ userRole }),
      setNetworkMode: (networkMode) => set({ networkMode }),
    }),
    {
      name: preferenceKey('ui'),
      storage: preferenceStorage,
      version: 1,
      partialize: ({ uiMode, userRole, networkMode }) => ({ uiMode, userRole, networkMode }),
    },
  ),
);
