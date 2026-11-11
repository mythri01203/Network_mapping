import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  buildImpactIndex,
  type Customer,
  CUSTOMER_HIDDEN_TEXT,
  type DeviceBoard,
  type DeviceSaid,
  deviceStatusBoard,
  type Equipment,
  type Freshness,
  hasRecordedLocation,
  NO_LIVE_CONNECTION,
  type OltStatusRow,
  type PonStatusRow,
} from '@fibergis/shared';

import { useMapStore } from '../../stores/mapStore';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { useMonitoringData, useMonitoringSettings, useNow } from './useMonitoring';

/**
 * Network mapping Phase 20: the NOC screen. One line per PON port: what the device said about the
 * port, how many ONTs reported LOS or offline, open alarms, and how many customers are hit, with
 * "Show on map". Everything comes from stored rows and recorded links; with nothing sent it says
 * "No live connection". Customer names are shown only as the server sent them for this role.
 */

const FRESH_STYLE: Record<Freshness, string> = {
  live: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  stale: 'border-amber-300 bg-amber-50 text-amber-900',
  test: 'border-violet-300 bg-violet-50 text-violet-900',
  none: 'border-slate-300 bg-slate-50 text-slate-700',
};

const hasProblem = (p: PonStatusRow) =>
  p.openAlarms > 0 || p.impacted > 0 || p.counts.los > 0 || p.counts.offline > 0 || p.device?.record.state === 'down' || p.device?.record.state === 'degraded';

function DeviceLine({ said, none }: { said?: DeviceSaid; none: string }) {
  if (!said) return <span className="text-slate-500">{none}</span>;
  const bad = said.record.state === 'down' || said.record.state === 'degraded';
  return (
    <span className={bad && !said.shown.stale ? 'font-bold text-red-700' : 'text-slate-800'}>
      Device says: {said.label}
      {said.record.rawState ? ` ("${said.record.rawState}")` : ''} · {said.shown.note}
      {said.countsText ? ` · ${said.countsText}` : ''}
    </span>
  );
}

function Count({ label, value, warn, testId }: { label: string; value: number; warn?: boolean; testId?: string }) {
  return (
    <div className={`rounded-md border px-2 py-1 ${warn && value > 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 bg-white text-slate-800'}`} data-testid={testId}>
      <div className="text-base font-bold leading-tight">{value}</div>
      <div className="text-[11px] leading-tight">{label}</div>
    </div>
  );
}

type Named = Pick<Customer, 'id' | 'name' | 'hiddenFields'>;
type Placed = Pick<Equipment, 'id' | 'lat' | 'lng'>;

function PortCard({ port, onMap, customers }: { port: PonStatusRow; onMap?: () => void; customers: readonly Named[] }) {
  const [showCustomers, setShowCustomers] = useState(false);
  const names = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    return port.impactedCustomerIds.map((id) => {
      const c = byId.get(id);
      const hidden = !c || c.hiddenFields?.includes('name');
      return { id, name: hidden ? CUSTOMER_HIDDEN_TEXT : c.name, hidden };
    });
  }, [customers, port.impactedCustomerIds]);
  return (
    <li className={`space-y-2 rounded-xl border p-3 ${hasProblem(port) ? 'border-red-300 bg-white' : 'border-slate-200 bg-white'}`} data-testid="noc-port">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900" data-testid="noc-port-label">
            {port.label}
          </div>
          {port.cardLabel && <div className="text-[11px] text-slate-500">{port.cardLabel}</div>}
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${FRESH_STYLE[port.freshness]}`} data-testid="noc-port-freshness">
          {port.note}
        </span>
      </div>
      <div className="text-[11px]" data-testid="noc-port-device">
        <DeviceLine said={port.device} none="Port status: not sent by the device" />
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        <Count label="ONTs on record" value={port.onts} />
        <Count label="Online" value={port.counts.online} />
        <Count label="LOS" value={port.counts.los} warn testId="noc-port-los" />
        <Count label="Offline" value={port.counts.offline} warn />
        <Count label="Stale or no data" value={port.counts.stale + port.counts.no_data} />
        <Count label="Open alarms" value={port.openAlarms} warn testId="noc-port-alarms" />
      </div>
      <div className="text-[11px] text-slate-700" data-testid="noc-port-impacted">
        <strong>{port.impacted}</strong> of {port.customers} customer(s) on this port hit (LOS or offline now, or an open alarm)
        {port.mayBeCustomers > 0 ? ` · ${port.mayBeCustomers} more may be on it (path not fully recorded)` : ''}
        {port.testAlarms > 0 ? ` · ${port.testAlarms} TEST alarm(s), not real` : ''}
      </div>
      <div className="flex flex-wrap gap-2">
        {port.impacted > 0 && (
          <button
            type="button"
            onClick={() => setShowCustomers((v) => !v)}
            aria-expanded={showCustomers}
            className="min-h-[48px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800"
            data-testid="noc-port-customers-toggle"
          >
            {showCustomers ? 'Hide customers' : `Customers hit (${port.impacted})`}
          </button>
        )}
        {onMap && (
          <button type="button" onClick={onMap} className="min-h-[48px] rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white" data-testid="noc-port-map">
            <MapPin className="mr-1 inline h-4 w-4" /> Show on map
          </button>
        )}
      </div>
      {showCustomers && (
        <ul className="space-y-0.5 text-[11px]" data-testid="noc-port-customers">
          {names.map((n) => (
            <li key={n.id}>
              <span className={n.hidden ? 'italic text-slate-500' : 'text-slate-900'}>{n.name}</span> <span className="font-mono text-slate-500">{n.id}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function OltBlock({ olt, onlyProblems, customers, equipment }: { olt: OltStatusRow; onlyProblems: boolean; customers: readonly Named[]; equipment: readonly Placed[] }) {
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const record = equipment.find((e) => e.id === olt.oltId);
  const onMap =
    record && hasRecordedLocation(record)
      ? () => {
          useMapStore.getState().flyTo(record.lat, record.lng, 18);
          setModalOpen('monitoring', false);
        }
      : undefined;
  const ports = onlyProblems ? olt.ports.filter(hasProblem) : olt.ports;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="noc-olt">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900">{olt.label}</h4>
          <div className="text-[11px]">
            <DeviceLine said={olt.device} none="OLT status: not sent by the device" />
          </div>
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${FRESH_STYLE[olt.freshness]}`}>{olt.note}</span>
      </div>
      <div className="text-[11px] text-slate-700">
        {olt.ports.length} PON port(s) · {olt.counts.los} LOS · {olt.counts.offline} offline · {olt.openAlarms} open alarm(s) · {olt.impacted} customer(s) hit
      </div>
      {olt.cards.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-testid="noc-cards">
          {olt.cards.map((c) => (
            <li key={c.key} className={`rounded-md border px-2 py-1 text-[11px] ${FRESH_STYLE[c.freshness]}`}>
              <strong>{c.label}</strong>
              {c.model ? ` (${c.model})` : ''} · {c.device ? `device says ${c.device.label}` : 'card status not sent'} · {c.counts.los} LOS · {c.impacted} hit
            </li>
          ))}
        </ul>
      )}
      {olt.interfaces.length > 0 && (
        <ul className="space-y-0.5 text-[11px]" data-testid="noc-interfaces">
          {olt.interfaces.map((i) => (
            <li key={i.name}>
              Interface <span className="font-mono">{i.name}</span>: <DeviceLine said={i.device} none="" />
            </li>
          ))}
        </ul>
      )}
      {olt.ports.length === 0 ? (
        <p className="text-[11px] text-slate-500">No PON ports recorded on this OLT.</p>
      ) : ports.length === 0 ? (
        <p className="text-[11px] text-slate-500">No port with a problem reported.</p>
      ) : (
        <ul className="space-y-2">
          {ports.map((p) => (
            <PortCard key={p.key} port={p} onMap={onMap} customers={customers} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function NocPanel() {
  const monitoring = useMonitoringData();
  const settings = useMonitoringSettings();
  const optical = useNetworkStore(selectOpticalSettings);
  const now = useNow();
  const data = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      splitters: s.splitters,
      closures: s.closures,
      customers: s.customers,
      spans: s.spans,
      attachments: s.attachments,
      onts: s.onts,
      services: s.services,
      alarms: s.alarms,
      rfElements: s.rfElements,
      rfLinks: s.rfLinks,
    })),
  );
  // Customers on each port by recorded fiber path too, not only by what their record names.
  const ix = useMemo(
    () => buildImpactIndex(data, optical),
    // Only the recorded network matters for paths; alarms do not change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.equipment, data.cables, data.splitters, data.closures, data.customers, data.spans, data.attachments, data.onts, data.services, data.rfElements, data.rfLinks, optical],
  );
  const board = useMemo(() => deviceStatusBoard({ ...data, ...monitoring }, { settings, now, impact: ix }), [data, monitoring, settings, now, ix]);
  return <NocBoardView board={board} statusStaleMinutes={settings.statusStaleMinutes} customers={data.customers} equipment={data.equipment} />;
}

/** The NOC screen for a board already worked out (also used by tests). */
export function NocBoardView({ board, statusStaleMinutes, customers, equipment }: { board: DeviceBoard; statusStaleMinutes: number; customers: readonly Named[]; equipment: readonly Placed[] }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const settings = { statusStaleMinutes };
  return (
    <div className="space-y-3 text-xs text-slate-700" data-testid="noc-panel">
      {board.live ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900" data-testid="noc-live">
          <strong>Live</strong> · a real source sent OLT, port or ONU status in the last {settings.statusStaleMinutes} min. Each line shows its own age.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3" data-testid="noc-no-live">
          <strong>{NO_LIVE_CONNECTION}</strong>. No real source has sent OLT, port or ONU status in the last {settings.statusStaleMinutes} min. Counts below are from the records and the
          last rows kept, never from guesses.
        </div>
      )}
      <button
        type="button"
        onClick={() => setOnlyProblems((v) => !v)}
        aria-pressed={onlyProblems}
        className={`min-h-[48px] rounded-lg px-4 text-xs font-semibold ${onlyProblems ? 'bg-red-600 text-white' : 'border border-slate-300 bg-white text-slate-800'}`}
        data-testid="noc-only-problems"
      >
        {onlyProblems ? 'Showing ports with a problem only · show all' : 'Show only ports with a problem'}
      </button>
      {board.olts.length === 0 ? (
        <p className="text-slate-500" data-testid="noc-no-olt">
          No OLT is recorded yet.
        </p>
      ) : (
        board.olts.map((o) => <OltBlock key={o.oltId} olt={o} onlyProblems={onlyProblems} customers={customers} equipment={equipment} />)
      )}
      <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">
        {board.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>An offline or LOS customer alone does not prove a fibre cut. Use Faults and field work, Suspected causes, to compare alarms with the recorded paths.</li>
      </ul>
    </div>
  );
}
