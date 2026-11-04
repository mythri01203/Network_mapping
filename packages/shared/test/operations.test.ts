import { describe, expect, it } from 'vitest';
import { applyPatch } from '../src/domain/command';
import {
  createWorkOrder,
  customersAffectedBy,
  reportFault,
  resolveFault,
  setWorkOrderStatus,
} from '../src/domain/operations';
import { NOW, emptyNetwork, fault, smallNetwork, workOrder } from './fixtures';

const ctx = { now: NOW };

describe('customersAffectedBy', () => {
  it('collects customers downstream of equipment and cables', () => {
    expect(customersAffectedBy(smallNetwork(), { equipmentId: 'FDT-01' })).toEqual(['CUST-001']);
    expect(customersAffectedBy(smallNetwork(), { cableId: 'FEED-01' })).toEqual(['CUST-001']);
    expect(customersAffectedBy(smallNetwork(), { cableId: 'NOPE' })).toEqual([]);
  });
});

describe('reportFault', () => {
  it('fails when the affected asset does not exist', () => {
    expect(reportFault(smallNetwork(), { affectedEquipmentId: 'GHOST' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Asset Missing' },
    });
    expect(reportFault(smallNetwork(), { affectedCableId: 'GHOST' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Asset Missing' },
    });
  });

  it('derives location and affected customers from the failed equipment', () => {
    const result = reportFault(smallNetwork(), { affectedEquipmentId: 'FAT-01', severity: 'High' }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      id: 'FLT-2026-001',
      title: 'Fiber Cut at FAT-01',
      affectedLocation: { lat: 17.42, lng: 78.42 },
      affectedCustomerIds: ['CUST-001'],
      reportedAt: '2026-11-04 09:30',
      status: 'Reported',
    });
    expect(result.notice?.message).toContain('1 customer(s) affected');
  });

  it('uses the cable midpoint, then the network anchor, then the fallback', () => {
    const viaCable = reportFault(smallNetwork(), { affectedCableId: 'DIST-01' }, ctx);
    if (!viaCable.ok) throw new Error(viaCable.error.message);
    expect(viaCable.value.affectedLocation).toEqual({ lat: 17.42, lng: 78.42 });

    const anchored = reportFault(smallNetwork(), {}, ctx);
    if (!anchored.ok) throw new Error(anchored.error.message);
    expect(anchored.value.affectedLocation).toEqual({ lat: 17.4, lng: 78.4 });

    const fallback = reportFault(emptyNetwork(), {}, { ...ctx, fallbackLocation: [12, 77] });
    if (!fallback.ok) throw new Error(fallback.error.message);
    expect(fallback.value.affectedLocation).toEqual({ lat: 12, lng: 77 });
  });

  it('continues the yearly sequence and rejects duplicates', () => {
    const data = { ...emptyNetwork(), faults: [fault({ id: 'FLT-2026-007' })] };
    const next = reportFault(data, {}, ctx);
    expect(next.ok && next.value.id).toBe('FLT-2026-008');
    expect(reportFault(data, { id: 'FLT-2026-007' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Duplicate Fault ID' },
    });
  });
});

describe('resolveFault', () => {
  it('resolves the fault and completes its open work orders', () => {
    const data = {
      ...emptyNetwork(),
      faults: [fault({ id: 'F1', status: 'Dispatched', workOrderId: 'WO-1' })],
      workOrders: [
        workOrder({ id: 'WO-1', status: 'In Progress' }),
        workOrder({ id: 'WO-2', faultId: 'F1', status: 'Assigned' }),
        workOrder({ id: 'WO-3', faultId: 'F1', status: 'Cancelled' }),
        workOrder({ id: 'WO-4', status: 'Pending' }),
      ],
    };
    const result = resolveFault(data, 'F1', ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ status: 'Resolved', resolvedAt: '2026-11-04 09:30' });
    const statuses = Object.fromEntries(applyPatch(data, result.patch).workOrders.map((w) => [w.id, w.status]));
    expect(statuses).toEqual({ 'WO-1': 'Completed', 'WO-2': 'Completed', 'WO-3': 'Cancelled', 'WO-4': 'Pending' });
  });

  it('reports an already resolved fault as info', () => {
    const data = { ...emptyNetwork(), faults: [fault({ id: 'F1', status: 'Resolved' })] };
    expect(resolveFault(data, 'F1', ctx)).toMatchObject({
      ok: false,
      error: { title: 'Already Resolved', tone: 'info' },
    });
  });
});

describe('work orders', () => {
  it('requires a title and an existing fault', () => {
    expect(createWorkOrder(emptyNetwork(), { title: '   ' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Missing Title' },
    });
    expect(createWorkOrder(emptyNetwork(), { title: 'Fix', faultId: 'F404' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Fault Missing' },
    });
  });

  it('dispatches the linked fault to the technician', () => {
    const data = { ...emptyNetwork(), faults: [fault({ id: 'F1' })] };
    const result = createWorkOrder(data, { title: ' Splice repair ', faultId: 'F1', technicianName: 'Ravi' }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      id: 'WO-2026-001',
      title: 'Splice repair',
      status: 'Assigned',
      scheduledDate: '2026-11-04',
    });
    expect(applyPatch(data, result.patch).faults[0]).toMatchObject({
      workOrderId: 'WO-2026-001',
      status: 'Dispatched',
      assignedTechnician: 'Ravi',
    });
  });

  it('keeps the linked fault in step with status changes', () => {
    const data = {
      ...emptyNetwork(),
      faults: [fault({ id: 'F1', status: 'Dispatched' })],
      workOrders: [workOrder({ id: 'WO-1', faultId: 'F1', status: 'Assigned' })],
    };
    const started = setWorkOrderStatus(data, 'WO-1', 'In Progress', ctx);
    if (!started.ok) throw new Error(started.error.message);
    expect(applyPatch(data, started.patch).faults[0].status).toBe('In Progress');
    expect(started.audit[0].details).toBe('WO-1: Assigned → In Progress');

    const done = setWorkOrderStatus(data, 'WO-1', 'Completed', ctx);
    if (!done.ok) throw new Error(done.error.message);
    expect(done.value.completedDate).toBe('2026-11-04');
    expect(done.patch.faults).toBeUndefined();
  });

  it('treats the current status as a silent no-op', () => {
    const data = { ...emptyNetwork(), workOrders: [workOrder({ id: 'WO-1', status: 'Pending' })] };
    const result = setWorkOrderStatus(data, 'WO-1', 'Pending', ctx);
    expect(result).toMatchObject({ ok: true, patch: {}, audit: [] });
    if (result.ok) expect(result.notice).toBeUndefined();
  });
});
