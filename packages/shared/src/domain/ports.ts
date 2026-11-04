import type { LogicalPortStatus } from '../model/enums';
import type { Equipment, EquipmentPort } from '../model/types';
import { isoDate } from './time';

export function portTypeForEquipment(type: string): string {
  if (type === 'OLT') return 'PON';
  if (type === 'ODF') return 'ODF';
  if (type === 'FDMS') return 'FDMS';
  if (type === 'FDT') return 'FDT';
  if (type.includes('Splitter')) return 'Splitter';
  if (type.includes('FAT') || type.includes('Terminal')) return 'Terminal';
  return 'Port';
}

export function generateLogicalPorts(eq: Equipment): EquipmentPort[] {
  if (eq.logicalPorts && eq.logicalPorts.length > 0) return eq.logicalPorts;

  if (eq.type === 'OLT' && eq.ponPorts?.length) {
    return eq.ponPorts.map((pon) => ({
      id: pon.id,
      portNumber: pon.portNumber,
      portType: 'PON',
      status: pon.status === 'Active' ? 'Used' : pon.status === 'Faulty' ? 'Damaged' : 'Available',
      connectedCableId: pon.connectedFeederCableId,
      remarks: `${pon.connectedCustomersCount} customers`,
      assignedDate: pon.status === 'Active' ? eq.installedDate : undefined,
    }));
  }

  const total = eq.totalPorts || 0;
  if (!total) return [];

  // Derive statuses only from the recorded counts: never invent damaged ports.
  const used = Math.min(Math.max(eq.usedPorts || 0, 0), total);
  const available = Math.min(Math.max(eq.availablePorts ?? total - used, 0), total - used);
  const reserved = total - used - available;

  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    let status: LogicalPortStatus = 'Available';
    if (n <= used) status = 'Used';
    else if (n <= used + reserved) status = 'Reserved';

    return {
      id: `${eq.id}-P${n.toString().padStart(3, '0')}`,
      portNumber: n,
      portType: portTypeForEquipment(eq.type),
      status,
      assignedDate: status === 'Used' ? eq.installedDate : undefined,
    };
  });
}

/** Marks the first matching port (by number, else first Available) as Used/Available and returns updated counts. */
export function setPortUsage(
  eq: Equipment,
  portNumber: number | undefined,
  used: boolean,
  customerId?: string,
  assignedDate = isoDate(),
) {
  const ports = generateLogicalPorts(eq).map((p) => ({ ...p }));
  let target = portNumber !== undefined ? ports.find((p) => p.portNumber === portNumber) : undefined;
  if (used && (!target || target.status === 'Used' || target.status === 'Damaged')) {
    target = ports.find((p) => p.status === 'Available') || ports.find((p) => p.status === 'Reserved');
  }
  if (!used && !target && customerId) target = ports.find((p) => p.customerId === customerId);
  if (target) {
    target.status = used ? 'Used' : 'Available';
    target.customerId = used ? customerId : undefined;
    target.assignedDate = used ? assignedDate : undefined;
  }
  const summary = summarizePorts(ports);
  return {
    ...eq,
    logicalPorts: ports,
    totalPorts: summary.total,
    usedPorts: summary.used,
    availablePorts: summary.available,
  };
}

export function summarizePorts(ports: EquipmentPort[]) {
  const total = ports.length;
  const used = ports.filter((p) => p.status === 'Used').length;
  const available = ports.filter((p) => p.status === 'Available').length;
  const reserved = ports.filter((p) => p.status === 'Reserved').length;
  const damaged = ports.filter((p) => p.status === 'Damaged').length;
  const unverified = ports.filter((p) => p.status === 'Unverified').length;
  const utilization = total ? Math.round((used / total) * 100) : 0;
  return { total, used, available, reserved, damaged, unverified, utilization };
}
