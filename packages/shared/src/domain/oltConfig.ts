import { PON_TECHNOLOGIES, type PonTechnology } from '../model/enums';
import type { Equipment, EquipmentPort, OltCard, OltConfig, OltShelf, OltSlot, PonPort } from '../model/types';

/**
 * The PON ports of an OLT at the given size. Existing ports keep their connections;
 * ports that do not exist yet start as Available.
 */
export function buildOltPonPorts(
  olt: Pick<Equipment, 'ponPorts' | 'totalPorts' | 'technology' | 'portColorMap'>,
  totalPorts: number = olt.ponPorts?.length || olt.totalPorts || 0,
): PonPort[] {
  return Array.from({ length: totalPorts }, (_, i) => {
    const portNumber = i + 1;
    const id = `PON-${String(portNumber).padStart(2, '0')}`;
    const existing = olt.ponPorts?.find((p) => p.portNumber === portNumber);
    const colorName = olt.portColorMap?.[existing?.id ?? id];
    if (existing) return colorName ? { ...existing, colorName } : existing;
    return {
      id,
      portNumber,
      technology: olt.technology,
      status: 'Available',
      colorName,
      connectedCustomersCount: 0,
    };
  });
}

export interface StandardPortColor {
  number: number;
  name: string;
  hex: string;
}

export const STANDARD_PORT_COLORS: StandardPortColor[] = [
  { number: 1, name: 'Blue', hex: '#0284c7' },
  { number: 2, name: 'Orange', hex: '#ea580c' },
  { number: 3, name: 'Green', hex: '#16a34a' },
  { number: 4, name: 'Brown', hex: '#78350f' },
  { number: 5, name: 'Slate', hex: '#64748b' },
  { number: 6, name: 'White', hex: '#f8fafc' },
  { number: 7, name: 'Red', hex: '#dc2626' },
  { number: 8, name: 'Black', hex: '#1e293b' },
  { number: 9, name: 'Yellow', hex: '#eab308' },
  { number: 10, name: 'Violet', hex: '#7c3aed' },
  { number: 11, name: 'Pink', hex: '#e11d48' },
  { number: 12, name: 'Aqua', hex: '#06b6d4' },
];

export interface OltDescriptionParams {
  name: string;
  id?: string;
  technology: PonTechnology;
  manufacturer?: string;
  model?: string;
  area?: string;
  street?: string;
  totalPorts: number;
  portColorMap?: Record<string, string>;
  splitters?: Array<{
    id: string;
    ratio: string;
    inPort: string;
    outPortsCount?: number;
    parentPonPort?: string;
  }>;
  cables?: Array<{
    id: string;
    name?: string;
    type?: string;
    coreCount?: number;
    colorHex?: string;
    ponPort?: string;
    lengthMeters?: number;
  }>;
}

/**
 * Generates the standardized dynamic OLT description according to Module 6 specifications.
 * Synthesizes OLT Name, Technology, Manufacturer, Model, Port Config, Port Colors, Splitter Config, and Cable Config.
 */
export function generateOltDescription(params: OltDescriptionParams): string {
  const lines: string[] = [];

  lines.push(`OLT Name: ${params.name || 'Unnamed OLT'}`);
  if (params.id) {
    lines.push(`OLT ID: ${params.id}`);
  }
  lines.push(`Technology: ${params.technology}`);
  lines.push(`Manufacturer: ${params.manufacturer || 'Not recorded'}`);
  lines.push(`Model: ${params.model || 'Not recorded'}`);

  if (params.area || params.street) {
    const loc = [params.street, params.area].filter(Boolean).join(', ');
    lines.push(`Location: ${loc}`);
  }

  lines.push('');
  lines.push('Port Configuration:');
  lines.push(`- Total PON Ports: ${params.totalPorts}`);
  lines.push(`- Port Type: ${params.technology}`);
  const lastPad = String(params.totalPorts).padStart(2, '0');
  lines.push(`- Port Numbers: PON-01 to PON-${lastPad}`);

  if (params.portColorMap && Object.keys(params.portColorMap).length > 0) {
    lines.push('');
    lines.push('Port Color Configuration:');
    const sortedPortKeys = Object.keys(params.portColorMap).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
      return numA - numB;
    });

    for (const key of sortedPortKeys) {
      lines.push(`- ${key}: ${params.portColorMap[key]}`);
    }
  }

  if (params.splitters && params.splitters.length > 0) {
    lines.push('');
    // Phase 10: these are the setup screen's proposals. A splitter record exists only once a person created it.
    lines.push('Splitter Plan (proposed):');
    for (const spl of params.splitters) {
      lines.push(`- Splitter ID: ${spl.id}`);
      lines.push(`  Split Ratio: ${spl.ratio}`);
      lines.push(`  Input Port: ${spl.inPort}${spl.parentPonPort ? ` (Fed by ${spl.parentPonPort})` : ''}`);
      lines.push(`  Output Ports: ${spl.outPortsCount || spl.ratio.split(':')[1] || 'Not recorded'}`);
    }
  }

  if (params.cables && params.cables.length > 0) {
    lines.push('');
    lines.push('Cable Configuration:');
    for (const c of params.cables) {
      lines.push(`- Cable ID: ${c.id}`);
      if (c.name) lines.push(`  Cable Name: ${c.name}`);
      lines.push(`  Cable Type: ${c.type || 'Not recorded'}`);
      if (c.coreCount) lines.push(`  Fiber Cores: ${c.coreCount}`);
      if (c.colorHex) lines.push(`  Cable Color: ${c.colorHex}`);
      if (c.ponPort) lines.push(`  Origin PON: ${c.ponPort}`);
      if (c.lengthMeters) lines.push(`  Length: ${c.lengthMeters.toFixed(1)} m`);
    }
  }

  return lines.join('\n');
}

/**
 * Automatically builds logical PON ports for an OLT based on port count and color coding.
 */
export function buildOltLogicalPorts(
  oltId: string,
  totalPorts: number,
  technology: PonTechnology,
  portColorMap: Record<string, string> = {},
): EquipmentPort[] {
  return Array.from({ length: totalPorts }, (_, i) => {
    const num = i + 1;
    const pad = String(num).padStart(2, '0');
    const portCode = `PON-${pad}`;
    const color = portColorMap[portCode] || STANDARD_PORT_COLORS[i % STANDARD_PORT_COLORS.length].name;

    return {
      id: `${oltId}-${portCode}`,
      portNumber: num,
      portType: 'PON',
      slotCardPort: portCode,
      technology,
      color,
      status: 'Available',
      remarks: `${technology} optical PON port ${num}`,
    };
  });
}

/**
 * Phase 10: the most PON ports one OLT record takes. A large chassis (16 or more slots of 16 ports)
 * stays well inside it; a higher number is almost certainly a typing mistake.
 */
export const MAX_OLT_PON_PORTS = 1024;
/** Phase 10: the most PON ports one card takes. */
export const MAX_CARD_PON_PORTS = 128;

/**
 * Validates OLT configuration rules according to Module 10 specifications:
 * - Technology must be one of the PON technologies
 * - Total ports must be a whole number from 1 to MAX_OLT_PON_PORTS (any count, such as 12)
 */
export function validateOltConfig(olt: Partial<Equipment> & { oltConfig?: Partial<OltConfig> }): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const tech = olt.oltConfig?.technology || olt.technology;
  if (!tech || !(PON_TECHNOLOGIES as readonly string[]).includes(tech)) {
    errors.push(`An OLT must have a valid technology selected (${PON_TECHNOLOGIES.join(', ')}).`);
  }

  const portCount = olt.oltConfig?.ponPortCount || olt.totalPorts || 0;
  if (!Number.isInteger(portCount) || portCount <= 0) {
    errors.push('Enter how many PON ports the OLT has (count them on its front), at least 1.');
  } else if (portCount > MAX_OLT_PON_PORTS) {
    errors.push(`${portCount} PON ports is more than one OLT can have here (${MAX_OLT_PON_PORTS} at most). Check the number.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Phase 10: chassis, shelves, slots and cards                          */
/* ------------------------------------------------------------------ */

export interface OltChassisProblem {
  severity: 'error' | 'warning';
  code: string;
  /** Stable within one OLT, so a change is judged only by the problems it adds. */
  key: string;
  message: string;
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What is wrong with an OLT's recorded chassis. Errors are broken data (two shelves or slots with one
 * name, a PON port on two cards, a card naming a port the OLT does not have, more ports than the card
 * holds, PON ports on an uplink, control or power card). A PON port on no card is only a warning,
 * because recording a chassis is often done a card at a time.
 */
export function oltChassisProblems(olt: Pick<Equipment, 'name' | 'ponPorts' | 'chassis'>): OltChassisProblem[] {
  const chassis = olt.chassis;
  if (!chassis) return [];
  const problems: OltChassisProblem[] = [];
  const error = (code: string, key: string, message: string) => problems.push({ severity: 'error', code, key, message });
  const portIds = new Set((olt.ponPorts ?? []).map((p) => p.id));
  const cardOf = new Map<string, string>();

  chassis.shelves.forEach((shelf, si) => {
    if (!shelf.label.trim()) error('olt_label_blank', `blank:${shelf.id}`, `${olt.name}: a shelf has no name. Write it as the OLT shows it, such as 0.`);
    else if (chassis.shelves.findIndex((s) => sameLabel(s.label, shelf.label)) !== si) {
      error('olt_shelf_twice', `shelf:${shelf.label.trim().toLowerCase()}`, `${olt.name} has two shelves named "${shelf.label}". Give each shelf its own name.`);
    }
    shelf.slots.forEach((slot, li) => {
      if (!slot.label.trim()) error('olt_label_blank', `blank:${slot.id}`, `${olt.name} shelf ${shelf.label}: a slot has no name. Write it as the OLT shows it, such as 5.`);
      else if (shelf.slots.findIndex((s) => sameLabel(s.label, slot.label)) !== li) {
        error('olt_slot_twice', `slot:${shelf.id}:${slot.label.trim().toLowerCase()}`, `${olt.name} shelf ${shelf.label} has two slots named "${slot.label}".`);
      }
      const card = slot.card;
      if (!card) return;
      const where = `shelf ${shelf.label} slot ${slot.label}`;
      const ids = card.ponPortIds ?? [];
      if (ids.length > 0 && card.kind && card.kind !== 'pon' && card.kind !== 'other') {
        error('olt_card_kind_ports', `kind:${slot.id}`, `${olt.name} ${where} is recorded as a${card.kind === 'uplink' ? 'n' : ''} ${card.kind} card but lists PON ports. Change the card kind or remove the ports.`);
      }
      if (card.portCount !== undefined && (!Number.isInteger(card.portCount) || card.portCount < 1 || card.portCount > MAX_CARD_PON_PORTS)) {
        error('olt_card_port_count', `count:${slot.id}`, `${olt.name} ${where}: a card holds 1 to ${MAX_CARD_PON_PORTS} ports, not ${card.portCount}. Check the number.`);
      }
      if (card.portCount !== undefined && ids.length > card.portCount) {
        error('olt_card_ports_over', `over:${slot.id}`, `${olt.name} ${where} holds ${card.portCount} ports but ${ids.length} PON ports are listed on it.`);
      }
      ids.forEach((pid, i) => {
        if (!portIds.has(pid)) {
          error('olt_card_pon_missing', `missing:${slot.id}:${pid}`, `${olt.name} ${where} names PON port ${pid}, which this OLT does not have.`);
          return;
        }
        const first = ids.indexOf(pid) === i;
        const other = cardOf.get(pid);
        if (!first || other) {
          error('olt_pon_two_cards', `twice:${pid}`, `${olt.name} PON port ${pid} is listed ${other ? `on ${other} and on ${where}` : `twice on ${where}`}. One port sits on one card.`);
          return;
        }
        cardOf.set(pid, where);
      });
    });
  });

  if (cardOf.size > 0) {
    const loose = (olt.ponPorts ?? []).filter((p) => !cardOf.has(p.id)).map((p) => p.id);
    if (loose.length > 0) {
      problems.push({
        severity: 'warning',
        code: 'olt_pon_no_card',
        key: 'loose',
        message: `${olt.name}: ${loose.length} PON port(s) are on no card yet (${loose.slice(0, 4).join(', ')}${loose.length > 4 ? ' …' : ''}).`,
      });
    }
  }
  return problems;
}

export interface PonPortPlace {
  shelf: OltShelf;
  slot: OltSlot;
  card: OltCard;
  /** "Shelf 0 · Slot 5 · GPHF" */
  text: string;
}

/** The shelf, slot and card a PON port sits on, when the chassis records it. */
export function ponPortPlace(olt: Pick<Equipment, 'chassis'>, ponPortId: string): PonPortPlace | undefined {
  for (const shelf of olt.chassis?.shelves ?? []) {
    for (const slot of shelf.slots) {
      if (slot.card?.ponPortIds?.includes(ponPortId)) {
        const text = [`Shelf ${shelf.label}`, `Slot ${slot.label}`, slot.card.model].filter(Boolean).join(' · ');
        return { shelf, slot, card: slot.card, text };
      }
    }
  }
  return undefined;
}

/**
 * The older free-text rack, shelf, slot and card count, exactly as written, for showing when no
 * chassis is recorded. Empty when none was written.
 */
export function chassisAsWritten(olt: Pick<Equipment, 'rackNumber' | 'shelfNumber' | 'slotNumber' | 'ponCardsCount'>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (olt.rackNumber?.trim()) rows.push({ label: 'Rack', value: olt.rackNumber.trim() });
  if (olt.shelfNumber?.trim()) rows.push({ label: 'Shelf', value: olt.shelfNumber.trim() });
  if (olt.slotNumber?.trim()) rows.push({ label: 'Slot', value: olt.slotNumber.trim() });
  if (olt.ponCardsCount !== undefined) rows.push({ label: 'PON cards', value: String(olt.ponCardsCount) });
  return rows;
}

/** PON port ids on no card, in port order. The screen offers them; a person picks which go on a card. */
export function ponPortsOnNoCard(olt: Pick<Equipment, 'ponPorts' | 'chassis'>, exceptSlotId?: string): string[] {
  const taken = new Set<string>();
  for (const shelf of olt.chassis?.shelves ?? []) {
    for (const slot of shelf.slots) if (slot.id !== exceptSlotId) for (const id of slot.card?.ponPortIds ?? []) taken.add(id);
  }
  return [...(olt.ponPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber).map((p) => p.id).filter((id) => !taken.has(id));
}
