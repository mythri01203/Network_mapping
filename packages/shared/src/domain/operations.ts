import type { Fault, WorkOrder } from '../model/types';
import {
  type CommandContext,
  type CommandResult,
  fail,
  networkAnchor,
  type NetworkData,
  notice,
  succeed,
} from './command';
import { faultVerificationOf } from './faultRules';
import { nextSequentialId } from './ids';
import { formatTimestamp, isoDate } from './time';
import { collectDownstream } from './trace';

export type FaultDraft = Partial<Fault>;
export type WorkOrderDraft = Partial<WorkOrder> & { title: string };

const isOpenOrder = (w: WorkOrder) => !['Completed', 'Cancelled', 'Verified', 'Closed'].includes(w.status);

/** Customers that lose service when the given equipment or cable fails. */
export function customersAffectedBy(data: NetworkData, target: { equipmentId?: string; cableId?: string }): string[] {
  if (target.equipmentId) return collectDownstream(target.equipmentId, data).customers.map((c) => c.id);
  const cable = target.cableId ? data.cables.find((c) => c.id === target.cableId) : undefined;
  if (!cable) return [];
  const viaCable = data.customers.filter(
    (c) => c.feederCableId === cable.id || c.distributionCableId === cable.id || c.dropCableId === cable.id,
  );
  const downstream = cable.endEquipmentId ? collectDownstream(cable.endEquipmentId, data).customers : [];
  return Array.from(new Set([...viaCable, ...downstream].map((c) => c.id)));
}

/**
 * Logs a fault. Location defaults to the affected equipment, then the cable midpoint, then the network anchor;
 * affected customers default to everything downstream of the failed asset.
 */
export function reportFault(data: NetworkData, draft: FaultDraft, ctx: CommandContext = {}): CommandResult<Fault> {
  const now = ctx.now ?? new Date();
  const eq = draft.affectedEquipmentId ? data.equipment.find((e) => e.id === draft.affectedEquipmentId) : undefined;
  const cable = draft.affectedCableId ? data.cables.find((c) => c.id === draft.affectedCableId) : undefined;
  if (draft.affectedEquipmentId && !eq) {
    return fail('Asset Missing', `Equipment ${draft.affectedEquipmentId} was not found.`);
  }
  if (draft.affectedCableId && !cable) return fail('Asset Missing', `Cable ${draft.affectedCableId} was not found.`);

  const id =
    draft.id ||
    nextSequentialId(
      `FLT-${now.getFullYear()}-`,
      data.faults.map((f) => f.id),
      3,
    );
  if (data.faults.some((f) => f.id === id)) return fail('Duplicate Fault ID', `Fault ${id} already exists.`);

  let location = draft.affectedLocation;
  if (!location && eq) location = { lat: eq.lat, lng: eq.lng };
  if (!location && cable && cable.coordinates.length > 0) {
    const [lat, lng] = cable.coordinates[Math.floor(cable.coordinates.length / 2)];
    location = { lat, lng };
  }
  if (!location) {
    const [lat, lng] = networkAnchor(data, ctx.fallbackLocation) ?? [0, 0];
    location = { lat, lng };
  }

  const affectedCustomerIds = draft.affectedCustomerIds?.length
    ? draft.affectedCustomerIds
    : customersAffectedBy(data, { equipmentId: eq?.id, cableId: cable?.id });
  const assetLabel = eq?.id || cable?.id;
  const type = draft.type || 'Fiber Cut';

  const fault: Fault = {
    id,
    title: draft.title || `${type} at ${assetLabel || 'field location'}`,
    type,
    severity: draft.severity || 'Critical',
    status: draft.status || 'Reported',
    affectedLocation: location,
    affectedCableId: draft.affectedCableId,
    affectedEquipmentId: draft.affectedEquipmentId,
    affectedCustomerIds,
    affectedCores: draft.affectedCores || [],
    affectedSplitterPorts: draft.affectedSplitterPorts || [],
    description: draft.description || 'Reported via field inspection',
    reportedAt: formatTimestamp(now),
    assignedTechnician: draft.assignedTechnician || 'Unassigned',
    workOrderId: draft.workOrderId,
    images: draft.images || [],
  };

  return succeed(
    fault,
    { faults: [fault, ...data.faults] },
    {
      notice: notice(
        'error',
        'Network Fault Logged',
        `Registered ${fault.type} (${fault.id}) · ${fault.severity} · ${affectedCustomerIds.length} customer(s) affected`,
      ),
      audit: [
        {
          action: 'FAULT_REPORTED',
          details: `${fault.type} ${fault.id} on ${assetLabel || 'unspecified asset'} (${affectedCustomerIds.length} customers)`,
          assetId: fault.id,
          assetType: 'Fault',
        },
      ],
    },
  );
}

/**
 * Closes a fault and completes every open work order dispatched for it. Since Phase 8 a fault
 * closes only with a check (its own verification or one of its jobs'); without one it is refused.
 * Prefer `setFaultStatus(..., 'Closed')` in `faultCommands.ts`, which also clears its alarms.
 */
export function resolveFault(data: NetworkData, faultId: string, ctx: CommandContext = {}): CommandResult<Fault> {
  const fault = data.faults.find((f) => f.id === faultId);
  if (!fault) return fail('Fault Missing', `Fault ${faultId} was not found.`);
  if (fault.status === 'Resolved' || fault.status === 'Closed') return fail('Already Resolved', `${faultId} is already closed.`, 'info');
  const verification = faultVerificationOf(data, fault);
  if (!verification) {
    return fail('Check needed', `${faultId} cannot be closed without a check: a light reading measured in the field, a photo, or an office check.`);
  }

  const resolved: Fault = {
    ...fault,
    status: 'Closed',
    resolvedAt: formatTimestamp(ctx.now),
    closedAt: (ctx.now ?? new Date()).toISOString(),
    verification: fault.verification ?? verification,
  };
  const linked = data.workOrders.filter((w) => (w.faultId === faultId || w.id === fault.workOrderId) && isOpenOrder(w));
  const linkedIds = new Set(linked.map((w) => w.id));
  const completed = linked.map((w) => w.id).join(', ');

  return succeed(
    resolved,
    {
      faults: data.faults.map((f) => (f.id === faultId ? resolved : f)),
      ...(linked.length > 0
        ? {
            workOrders: data.workOrders.map((w) =>
              linkedIds.has(w.id) ? { ...w, status: 'Completed' as const, completedDate: isoDate(ctx.now) } : w,
            ),
          }
        : {}),
    },
    {
      notice: notice(
        'success',
        'Fault Resolved',
        `Outage ${faultId} marked resolved${linked.length ? ` and ${completed} completed` : ''}.`,
      ),
      audit: [
        {
          action: 'FAULT_RESOLVED',
          details: `Resolved ${faultId}${linked.length ? `; completed ${completed}` : ''}`,
          assetId: faultId,
          assetType: 'Fault',
        },
      ],
    },
  );
}

/** Creates a work order; when it targets a fault, the fault is marked Dispatched to the assigned technician. */
export function createWorkOrder(
  data: NetworkData,
  draft: WorkOrderDraft,
  ctx: CommandContext = {},
): CommandResult<WorkOrder> {
  const now = ctx.now ?? new Date();
  const title = draft.title.trim();
  if (!title) return fail('Missing Title', 'A work order needs a title.');
  if (draft.faultId && !data.faults.some((f) => f.id === draft.faultId)) {
    return fail('Fault Missing', `Fault ${draft.faultId} was not found.`);
  }
  const id =
    draft.id ||
    nextSequentialId(
      `WO-${now.getFullYear()}-`,
      data.workOrders.map((w) => w.id),
      3,
    );
  if (data.workOrders.some((w) => w.id === id)) return fail('Duplicate Work Order', `Work order ${id} already exists.`);

  const order: WorkOrder = {
    id,
    title,
    type: draft.type || 'Repair',
    priority: draft.priority || 'Medium',
    status: draft.status || (draft.technicianName ? 'Assigned' : 'Pending'),
    technicianName: draft.technicianName || 'Unassigned',
    technicianPhone: draft.technicianPhone || '',
    equipmentId: draft.equipmentId,
    cableId: draft.cableId,
    customerId: draft.customerId,
    faultId: draft.faultId,
    scheduledDate: draft.scheduledDate || isoDate(now),
    completedDate: draft.completedDate,
    notes: draft.notes || '',
    photos: draft.photos || [],
  };

  return succeed(
    order,
    {
      workOrders: [order, ...data.workOrders],
      ...(order.faultId
        ? {
            faults: data.faults.map((f) =>
              f.id === order.faultId
                ? {
                    ...f,
                    workOrderId: order.id,
                    status: f.status === 'Resolved' ? f.status : ('Dispatched' as const),
                    assignedTechnician:
                      order.technicianName !== 'Unassigned' ? order.technicianName : f.assignedTechnician,
                  }
                : f,
            ),
          }
        : {}),
    },
    {
      notice: notice('success', 'Work Order Created', `${order.id}: ${order.title}`),
      audit: [
        {
          action: 'WORK_ORDER_CREATED',
          details: `${order.type} ${order.id}${order.faultId ? ` for ${order.faultId}` : ''} (${order.priority})`,
          assetId: order.id,
          assetType: 'WorkOrder',
        },
      ],
    },
  );
}

/**
 * Moves a work order through its lifecycle and keeps the linked fault's status in step.
 * Setting the current status again is a silent no-op.
 */
export function setWorkOrderStatus(
  data: NetworkData,
  workOrderId: string,
  status: WorkOrder['status'],
  ctx: CommandContext = {},
): CommandResult<WorkOrder> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return fail('Work Order Missing', `Work order ${workOrderId} was not found.`);
  if (order.status === status) return succeed(order, {});

  const updated: WorkOrder = {
    ...order,
    status,
    completedDate: status === 'Completed' ? isoDate(ctx.now) : order.completedDate,
  };
  const syncFault = order.faultId && (status === 'In Progress' || status === 'Assigned');

  return succeed(
    updated,
    {
      workOrders: data.workOrders.map((w) => (w.id === workOrderId ? updated : w)),
      ...(syncFault
        ? {
            faults: data.faults.map((f) =>
              f.id === order.faultId && f.status !== 'Resolved'
                ? { ...f, status: status === 'In Progress' ? ('In Progress' as const) : ('Dispatched' as const) }
                : f,
            ),
          }
        : {}),
    },
    {
      notice: notice('success', 'Work Order Updated', `Work Order ${workOrderId} status changed to ${status}`),
      audit: [
        {
          action: 'WORK_ORDER_STATUS',
          details: `${workOrderId}: ${order.status} → ${status}`,
          assetId: workOrderId,
          assetType: 'WorkOrder',
        },
      ],
    },
  );
}
