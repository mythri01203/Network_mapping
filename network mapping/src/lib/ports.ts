import { Equipment, EquipmentPort, LogicalPortStatus } from '../types/network';

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
    return eq.ponPorts.map(pon => ({
      id: pon.id,
      portNumber: pon.portNumber,
      portType: 'PON',
      status: pon.status === 'Active' ? 'Used' : pon.status === 'Faulty' ? 'Damaged' : 'Available',
      connectedCableId: pon.connectedFeederCableId,
      remarks: `${pon.connectedCustomersCount} customers`,
      assignedDate: pon.status === 'Active' ? eq.installedDate : undefined
    }));
  }

  const total = eq.totalPorts || 0;
  if (!total) return [];

  const used = eq.usedPorts || 0;
  const reserved = Math.min(2, Math.max(0, total - used - 1));
  const damaged = used < total ? 1 : 0;

  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    let status: LogicalPortStatus = 'Available';
    if (n <= used) status = 'Used';
    else if (n <= used + reserved) status = 'Reserved';
    else if (n === total && damaged) status = 'Damaged';

    return {
      id: `${eq.id}-P${n.toString().padStart(3, '0')}`,
      portNumber: n,
      portType: portTypeForEquipment(eq.type),
      status,
      assignedDate: status === 'Used' ? eq.installedDate : undefined,
      remarks: status === 'Damaged' ? 'Marked damaged during inspection' : undefined
    };
  });
}

export function summarizePorts(ports: EquipmentPort[]) {
  const total = ports.length;
  const used = ports.filter(p => p.status === 'Used').length;
  const available = ports.filter(p => p.status === 'Available').length;
  const reserved = ports.filter(p => p.status === 'Reserved').length;
  const damaged = ports.filter(p => p.status === 'Damaged').length;
  const unverified = ports.filter(p => p.status === 'Unverified').length;
  const utilization = total ? Math.round((used / total) * 100) : 0;
  return { total, used, available, reserved, damaged, unverified, utilization };
}
