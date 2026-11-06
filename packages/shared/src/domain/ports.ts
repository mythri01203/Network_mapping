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

  const isSplitter = eq.type.includes('Splitter') || eq.type === 'Outdoor Splitter' || eq.type === 'Ratio Coupler';
  const isOdf = eq.type === 'ODF';
  const isOlt = eq.type === 'OLT';

  // Splitters have 1 input port (IN-01) plus N output ports (OUT-01..OUT-0N)
  if (isSplitter) {
    const outCount = total;
    const ports: EquipmentPort[] = [];
    
    // Inbound port
    ports.push({
      id: `${eq.id}-IN-01`,
      portNumber: 0,
      portType: 'Inbound',
      slotCardPort: 'IN-01',
      status: eq.usedPorts && eq.usedPorts > 0 ? 'Used' : 'Available',
      assignedDate: eq.installedDate,
      remarks: 'Primary optical feeder input',
    });

    // Outbound ports
    for (let i = 1; i <= outCount; i++) {
      let status: LogicalPortStatus = 'Available';
      if (i <= used) status = 'Used';
      else if (i <= used + reserved) status = 'Reserved';

      const pad = String(i).padStart(2, '0');
      ports.push({
        id: `${eq.id}-OUT-${pad}`,
        portNumber: i,
        portType: 'Outbound',
        slotCardPort: `OUT-${pad}`,
        status,
        assignedDate: status === 'Used' ? eq.installedDate : undefined,
        remarks: `Optical split branch ${i} of ${outCount}`,
      });
    }

    return ports;
  }

  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    let status: LogicalPortStatus = 'Available';
    if (n <= used) status = 'Used';
    else if (n <= used + reserved) status = 'Reserved';

    const pad = String(n).padStart(2, '0');
    const portCode = isOlt ? `PON-${pad}` : isOdf ? `PORT-${pad}` : `P${String(n).padStart(3, '0')}`;

    return {
      id: `${eq.id}-${portCode}`,
      portNumber: n,
      portType: portTypeForEquipment(eq.type),
      slotCardPort: portCode,
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
