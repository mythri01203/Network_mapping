import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackup } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { storageKey } from '../lib/storage';
import { useConfirmStore } from './confirmStore';
import * as actions from './networkActions';
import { getNetworkSnapshot, MAX_HISTORY, selectCanRedo, selectCanUndo, useNetworkStore } from './networkStore';
import { useToastStore } from './toastStore';
import { useTraceStore } from './traceStore';
import { useUiStore } from './uiStore';

const pristine = useNetworkStore.getState();
const draft = { name: 'Test FAT', type: 'FAT' as const, lat: 12.97, lng: 77.59 };

/** A new, unconnected device: the sample's equipment is cabled and can't be deleted. */
const addLooseEquipment = () => actions.addEquipment(draft)!;
const lastToast = () => useToastStore.getState().toasts.at(-1);
const stored = (key: string): unknown => JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useUiStore.setState({ selectedObject: null });
  useToastStore.setState({ toasts: [] });
  useTraceStore.getState().clear();
  useConfirmStore.setState({ pending: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('initial load', () => {
  it('seeds the bundled sample network with an empty component catalog', () => {
    const sample = createSampleNetwork();
    expect(pristine.equipment).toEqual(sample.equipment);
    expect(pristine.cables).toEqual(sample.cables);
    expect(pristine.catalog).toEqual([]);
    expect(pristine.history).toMatchObject({ index: 0 });
    expect(pristine.history.stack).toHaveLength(1);
  });
});

describe('runCommand', () => {
  it('applies a successful command with history, toast, audit and persistence', () => {
    const created = actions.addEquipment(draft);

    expect(created).toMatchObject({ name: 'Test FAT', type: 'FAT' });
    const state = useNetworkStore.getState();
    expect(state.equipment.some((e) => e.id === created!.id)).toBe(true);
    expect(state.history.index).toBe(1);
    expect(state.auditLogs[0]).toMatchObject({ assetId: created!.id, role: 'Network Engineer' });
    expect(state.auditLogs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(lastToast()?.type).toBe('success');
    expect(stored('equipment')).toEqual(state.equipment);
  });

  it('reports a failed command as a toast without touching state', () => {
    const before = useNetworkStore.getState();
    actions.updateEquipment({ ...before.equipment[0], id: 'DOES-NOT-EXIST' });

    const after = useNetworkStore.getState();
    expect(after.equipment).toBe(before.equipment);
    expect(after.history).toBe(before.history);
    expect(lastToast()?.type).toMatch(/error|warning/);
  });

  it('skips toasts and audit entries for silent commands', () => {
    const target = useNetworkStore.getState().equipment[0];
    const logCount = useNetworkStore.getState().auditLogs.length;
    actions.updateEquipment({ ...target, name: 'Renamed' }, { silent: true });

    expect(useNetworkStore.getState().equipment[0].name).toBe('Renamed');
    expect(useNetworkStore.getState().auditLogs).toHaveLength(logCount);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('asks for confirmation and aborts when the user declines', async () => {
    const target = addLooseEquipment();

    const deleted = actions.deleteEquipment(target.id);
    expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Delete equipment', tone: 'danger' });
    useConfirmStore.getState().respond(false);

    await expect(deleted).resolves.toBe(false);
    expect(useConfirmStore.getState().pending).toBeNull();
    expect(useNetworkStore.getState().equipment).toContain(target);
  });

  it('applies the command once the user confirms', async () => {
    const target = addLooseEquipment();

    const deleted = actions.deleteEquipment(target.id);
    useConfirmStore.getState().respond(true);

    await expect(deleted).resolves.toBe(true);
    expect(useNetworkStore.getState().equipment.some((e) => e.id === target.id)).toBe(false);
  });

  it('skips the dialog when the caller already confirmed', async () => {
    const target = addLooseEquipment();

    await expect(actions.deleteEquipment(target.id, { skipConfirm: true })).resolves.toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
    expect(useNetworkStore.getState().equipment.some((e) => e.id === target.id)).toBe(false);
  });
});

describe('selection sync', () => {
  it('follows edits to the selected record and clears it once deleted', async () => {
    const target = addLooseEquipment();
    useUiStore.getState().select({ type: 'equipment', data: target });

    actions.updateEquipment({ ...target, name: 'Edited' });
    expect(useUiStore.getState().selectedObject?.data).toMatchObject({ id: target.id, name: 'Edited' });

    await actions.deleteEquipment(target.id, { skipConfirm: true });
    expect(useUiStore.getState().selectedObject).toBeNull();
  });
});

describe('undo / redo', () => {
  it('travels through history and restores the selection target', () => {
    const original = useNetworkStore.getState().equipment;
    const created = actions.addEquipment(draft)!;
    useUiStore.getState().select({ type: 'equipment', data: created });

    useNetworkStore.getState().undo();
    expect(useNetworkStore.getState().equipment).toEqual(original);
    expect(useUiStore.getState().selectedObject).toBeNull();
    expect(lastToast()?.title).toBe('Undo Successful');

    useNetworkStore.getState().redo();
    expect(useNetworkStore.getState().equipment.some((e) => e.id === created.id)).toBe(true);
    expect(lastToast()?.title).toBe('Redo Successful');
  });

  it('exposes whether undo and redo are available', () => {
    const state = () => useNetworkStore.getState();
    expect([selectCanUndo(state()), selectCanRedo(state())]).toEqual([false, false]);
    actions.addEquipment(draft);
    expect([selectCanUndo(state()), selectCanRedo(state())]).toEqual([true, false]);
    state().undo();
    expect([selectCanUndo(state()), selectCanRedo(state())]).toEqual([false, true]);
  });

  it('is a no-op at either end of the history', () => {
    const before = useNetworkStore.getState();
    before.undo();
    before.redo();
    expect(useNetworkStore.getState().history).toBe(before.history);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('leaves stored budget runs and map check findings alone: no undo step, and undo keeps them', () => {
    // The server refuses a delete or rollback of either, so undo must never try one.
    const run = { id: 'OBR-T1' } as never;
    const finding = { id: 'VF-T1', state: 'acknowledged' } as never;
    const store = (patch: Record<string, unknown>) =>
      useNetworkStore.getState().runCommand(() => ({ ok: true, value: null, patch, audit: [] }) as never);

    actions.addEquipment(draft);
    expect(useNetworkStore.getState().history.index).toBe(1);
    store({ opticalBudgetRuns: [run] });
    store({ validationFindings: [finding] });
    expect(useNetworkStore.getState().history.index).toBe(1);

    useNetworkStore.getState().undo();
    const state = useNetworkStore.getState();
    expect(state.equipment.some((e) => e.name === draft.name)).toBe(false);
    expect(state.opticalBudgetRuns).toEqual([run]);
    expect(state.validationFindings).toEqual([finding]);
    useNetworkStore.getState().redo();
    expect(useNetworkStore.getState().opticalBudgetRuns).toEqual([run]);
  });

  it('drops the redo branch on a new change and caps the stack', () => {
    actions.addEquipment(draft);
    useNetworkStore.getState().undo();
    actions.addEquipment({ ...draft, name: 'Branch' });
    const { history } = useNetworkStore.getState();
    expect(history.stack).toHaveLength(2);
    expect(history.index).toBe(1);

    for (let i = 0; i < MAX_HISTORY + 5; i++) actions.addEquipment({ ...draft, name: `Bulk ${i}` });
    expect(useNetworkStore.getState().history.stack).toHaveLength(MAX_HISTORY);
    expect(useNetworkStore.getState().history.index).toBe(MAX_HISTORY - 1);
  });
});

describe('backup restore', () => {
  it('asks before replacing the network, and with no server changes nothing (Phase 9)', async () => {
    const snapshot = { ...getNetworkSnapshot(), equipment: getNetworkSnapshot().equipment.slice(0, 2) };
    const backup = createBackup(snapshot, '2026-01-01T00:00:00.000Z', [1, 2]);
    actions.addEquipment(draft);
    const before = useNetworkStore.getState().equipment;

    const pending = actions.restoreSystem(JSON.stringify(backup));
    await vi.waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull());
    expect(useConfirmStore.getState().pending?.message).toMatch(/safety copy/);
    useConfirmStore.getState().respond(true);
    // The sync engine is not running here, as with no server: a restore needs the server.
    await expect(pending).resolves.toBe(false);
    expect(useNetworkStore.getState().equipment).toBe(before);
    expect(lastToast()?.title).toBe('Needs the server');
  });

  it('rejects invalid JSON and invalid backups', async () => {
    const before = useNetworkStore.getState().equipment;
    await expect(actions.restoreSystem('{not json')).resolves.toBe(false);
    await expect(actions.restoreSystem(JSON.stringify({ equipment: 'nope' }))).resolves.toBe(false);
    expect(useNetworkStore.getState().equipment).toBe(before);
    expect(lastToast()?.title).toBe('Restore Failed');
  });
});

describe('audit log', () => {
  it('prepends entries newest first', () => {
    actions.logAudit('FIRST', 'one', 'A', 'System');
    actions.logAudit('SECOND', 'two', 'B', 'System');
    const [latest, previous] = useNetworkStore.getState().auditLogs;
    expect(latest.action).toBe('SECOND');
    expect(previous.action).toBe('FIRST');
  });
});
