import type { OnuState } from '../model/monitoringSchemas';
import type { Customer, Equipment, Ont } from '../model/types';
import { isActiveCustomer, isLiveOnt } from './connectionRules';
import { DEFAULT_MONITORING_SETTINGS, type MonitoringSettings } from './monitoringSettings';
import { latestReading, latestStatus, liveSources, type MonitoringData, type ShownReading,showReading, showStatus } from './monitoringStatus';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings, type RxBand } from './opticalSettings';

/**
 * The monitoring dashboard (section 17.1), worked out from stored rows only. Customers are counted
 * from the newest real (not TEST) status of their ONT; a stale status is counted as stale, never as
 * online, and a customer with no row is "no data". TEST rows are counted apart and never added in.
 */

export type CustomerLiveState = OnuState | 'stale' | 'no_data' | 'no_ont_record';
export const CUSTOMER_LIVE_STATES: readonly CustomerLiveState[] = ['online', 'offline', 'los', 'dying_gasp', 'unknown', 'stale', 'no_data', 'no_ont_record'];
export const CUSTOMER_LIVE_STATE_LABELS: Record<CustomerLiveState, string> = {
  online: 'Online',
  offline: 'Offline',
  los: 'LOS (no light)',
  dying_gasp: 'Power lost (dying gasp)',
  unknown: 'Unknown (device said so)',
  stale: 'Stale: last status too old',
  no_data: 'No data from a source',
  no_ont_record: 'No ONT record to match',
};

export interface PonPortSummary {
  key: string;
  oltId?: string;
  ponPortId?: string;
  label: string;
  onts: number;
  counts: Partial<Record<CustomerLiveState, number>>;
  worstRxDbm?: number;
}

export interface WorstRx {
  ontId: string;
  customerIds: string[];
  reading: ShownReading;
}

export interface MonitoringSummary {
  live: boolean;
  realSources: number;
  lastReceivedAt?: string;
  customers: number;
  counts: Record<CustomerLiveState, number>;
  ponPorts: PonPortSummary[];
  worstRx: WorstRx[];
  unmatchedRows: number;
  testRows: number;
  staleOnts: number;
}

export interface SummaryData extends MonitoringData {
  customers: readonly Customer[];
  onts?: readonly Ont[];
  equipment: readonly Equipment[];
}

const BAND_ORDER: Record<RxBand, number> = { bad: 0, too_much_light: 1, low_margin: 2, good: 3, unknown: 4 };

export function customerLiveState(customer: Customer, data: SummaryData, settings: MonitoringSettings, now: Date): CustomerLiveState {
  if (!customer.ontId) return 'no_ont_record';
  const shown = showStatus(latestStatus(data, customer.ontId), data, settings, now);
  if (!shown.state) return 'no_data';
  return shown.stale ? 'stale' : shown.state;
}

export function summarizeMonitoring(
  data: SummaryData,
  optical: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
  settings: MonitoringSettings = DEFAULT_MONITORING_SETTINGS,
  now = new Date(),
): MonitoringSummary {
  const sources = liveSources(data, settings, now);
  const customers = data.customers.filter((c) => isActiveCustomer(c) && c.accessNetwork !== 'hfc');
  const counts = Object.fromEntries(CUSTOMER_LIVE_STATES.map((s) => [s, 0])) as Record<CustomerLiveState, number>;
  for (const c of customers) counts[customerLiveState(c, data, settings, now)] += 1;

  const onts = (data.onts ?? []).filter(isLiveOnt);
  const ports = new Map<string, PonPortSummary>();
  const worst: WorstRx[] = [];
  let staleOnts = 0;
  for (const ont of onts) {
    const status = showStatus(latestStatus(data, ont.id), data, settings, now);
    const state: CustomerLiveState = !status.state ? 'no_data' : status.stale ? 'stale' : status.state;
    if (status.stale) staleOnts += 1;
    const reading = showReading(latestReading(data, ont.id, 'ont_rx'), data, optical, settings, now);
    const key = `${ont.oltId ?? '?'}|${ont.ponPortId ?? '?'}`;
    const olt = data.equipment.find((e) => e.id === ont.oltId);
    const pon = olt?.ponPorts?.find((p) => p.id === ont.ponPortId);
    const label = ont.oltId ? `${olt?.name ?? ont.oltId} · ${pon?.vendorAddress ?? pon?.slotCardPort ?? ont.ponPortId ?? 'PON port not recorded'}` : 'OLT and PON port not recorded';
    const port = ports.get(key) ?? { key, oltId: ont.oltId, ponPortId: ont.ponPortId, label, onts: 0, counts: {} };
    port.onts += 1;
    port.counts[state] = (port.counts[state] ?? 0) + 1;
    if (reading.valueDbm !== undefined && (port.worstRxDbm === undefined || reading.valueDbm < port.worstRxDbm)) port.worstRxDbm = reading.valueDbm;
    ports.set(key, port);
    if (reading.valueDbm !== undefined && reading.band !== 'good') {
      worst.push({ ontId: ont.id, customerIds: data.customers.filter((c) => c.ontId === ont.id).map((c) => c.id), reading });
    }
  }
  worst.sort((a, b) => BAND_ORDER[a.reading.band] - BAND_ORDER[b.reading.band] || (a.reading.valueDbm ?? 0) - (b.reading.valueDbm ?? 0));
  const all = [...(data.onuStatuses ?? []), ...(data.onuReadings ?? [])];
  return {
    live: sources.live,
    realSources: sources.real.length,
    ...(sources.lastReceivedAt ? { lastReceivedAt: sources.lastReceivedAt } : {}),
    customers: customers.length,
    counts,
    ponPorts: [...ports.values()].sort((a, b) => a.label.localeCompare(b.label)),
    worstRx: worst.slice(0, 20),
    unmatchedRows: all.filter((r) => !r.ontId && !r.isTest).length,
    testRows: all.filter((r) => r.isTest).length,
    staleOnts,
  };
}
