import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleNetwork } from '@fibergis/shared/sample';

import { TOAST_DURATION_MS, useToastStore } from './toastStore';
import { knowledgeKeyFor, selectionLabel, useUiStore } from './uiStore';

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps only the most recent toasts visible', () => {
    const { show } = useToastStore.getState();
    for (let i = 1; i <= 6; i++) show('info', `T${i}`, '');
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['T3', 'T4', 'T5', 'T6']);
  });

  it('dismisses toasts automatically and on request', () => {
    const { show, dismiss } = useToastStore.getState();
    const first = show('success', 'Saved', '');
    show('error', 'Failed', '');
    dismiss(first);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['Failed']);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

describe('knowledgeKeyFor', () => {
  it.each([
    ['GPON OLT', 'gpon-olt'],
    ['OLT', 'olt'],
    ['FAT-03', 'fat'],
    ['Terminal Box', 'fat'],
    ['PLC Splitter 1x8', 'splitter'],
    ['Joint Closure', 'joint-closure'],
    ['Telecom Pole', 'telecom-pole'],
    ['Optical Receiver', 'optical-receiver'],
    ['Core Switch', 'core-switch'],
  ])('%s → %s', (input, key) => expect(knowledgeKeyFor(input)).toBe(key));
});

describe('selectionLabel', () => {
  const sample = createSampleNetwork();

  it('uses the name, or the title for faults', () => {
    const equipment = sample.equipment[0];
    const fault = sample.faults[0];
    expect(selectionLabel({ type: 'equipment', data: equipment })).toBe(equipment.name);
    expect(selectionLabel({ type: 'fault', data: fault })).toBe(fault.title);
  });

  it('falls back to the id when the label is empty', () => {
    const cable = { ...sample.cables[0], name: '' };
    expect(selectionLabel({ type: 'cable', data: cable })).toBe(cable.id);
  });
});

describe('uiStore', () => {
  it('opens the knowledge modal on the matching article', () => {
    useUiStore.getState().openKnowledge('GPON OLT');
    const { modals, selectedKnowledgeId } = useUiStore.getState();
    expect(selectedKnowledgeId).toBe('gpon-olt');
    expect(modals.knowledge).toBe(true);
    expect(modals.help).toBe(false);
  });

  it('accepts updater functions for panels and the sidebar', () => {
    const { setPanelOpen, setSidebarCollapsed } = useUiStore.getState();
    const collapsed = useUiStore.getState().isSidebarCollapsed;
    setPanelOpen('right', (open) => !open);
    setSidebarCollapsed((c) => !c);
    expect(useUiStore.getState().panels.right).toBe(true);
    expect(useUiStore.getState().isSidebarCollapsed).toBe(!collapsed);
  });

  it('persists only user preferences', () => {
    useUiStore.getState().setUiMode('pro');
    useUiStore.getState().setModalOpen('help', true);
    const saved = JSON.parse(localStorage.getItem('fiber_gis_ui_prefs') ?? '{}') as { state: object };
    expect(saved.state).toEqual({ uiMode: 'pro', userRole: 'Network Engineer', networkMode: 'All' });
  });
});
