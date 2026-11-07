import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, MapPinned, Play, Square } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type AgentTrip, agentTripTimeline, summarizeAgentTrip, type TrackedAsset } from '@fibergis/shared';

import { downloadFile } from '../../lib/browser';
import { readJson, writeJson } from '../../lib/storage';
import { type GpsBlockReason, useAgentTrackingStore } from '../../stores/agentTrackingStore';
import { requestConfirm } from '../../stores/confirmStore';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import {
  buildAgentReportCsv,
  describeTimelineEntry,
  exportAgentReportPdf,
  formatDate,
  formatDuration,
  formatTime,
  localDay,
} from './agentReport';

const LAST_AGENT_KEY = 'agent_last_name';

const GPS_HELP: Record<GpsBlockReason, { title: string; steps: string }> = {
  unsupported: {
    title: 'This browser cannot use GPS',
    steps: 'Open the app in a current version of Chrome, Edge or Safari. Phones also need the app on an https address.',
  },
  denied: {
    title: 'Location permission is blocked',
    steps:
      'Click the icon beside the address bar, set Location to Allow and reload the page. Then click Start Duty again. On a phone, also allow location for the browser in Settings.',
  },
  unavailable: {
    title: 'GPS is off or has no signal',
    steps: 'Turn on location on this device, move somewhere with a clear view of the sky, then click Start Duty again.',
  },
};

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-500';

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function TripTimeline({ trip, assets, editable }: { trip: AgentTrip; assets: readonly TrackedAsset[]; editable: boolean }) {
  const setStopNote = useAgentTrackingStore((s) => s.setStopNote);
  const entries = useMemo(() => agentTripTimeline(trip, assets), [trip, assets]);
  return (
    <ol className="space-y-1.5 text-[13px]">
      {entries.map((entry) => (
        <li key={`${entry.kind}-${entry.startMs}`} className="flex gap-3">
          <span className="w-28 shrink-0 tabular-nums text-slate-500">
            {formatTime(entry.startMs)}
            {entry.endMs > entry.startMs ? ` – ${formatTime(entry.endMs)}` : ''}
          </span>
          <div className="min-w-0 flex-1">
            <span className={entry.kind === 'gap' ? 'font-medium text-red-700' : 'text-slate-800'}>
              {describeTimelineEntry({ ...entry, ...(entry.kind === 'stop' ? { note: undefined } : {}) })}
            </span>
            {entry.endMs > entry.startMs && (
              <span className="ml-1.5 text-slate-500">({formatDuration(entry.endMs - entry.startMs)})</span>
            )}
            {entry.kind === 'stop' &&
              (editable ? (
                <input
                  aria-label={`Note for stop at ${formatTime(entry.startMs)}`}
                  defaultValue={entry.note ?? ''}
                  onBlur={(e) => setStopNote(entry.startMs, e.target.value)}
                  placeholder="Add a note, such as Repaired FAT-09"
                  className={`${inputClass} mt-1 py-1`}
                />
              ) : (
                entry.note && <p className="mt-0.5 text-slate-600">Note: {entry.note}</p>
              ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DutyCard({ assets, agentNames }: { assets: readonly TrackedAsset[]; agentNames: string[] }) {
  const { activeTripId, isStarting, startError, gpsProblem, startDuty, endDuty } = useAgentTrackingStore(
    useShallow((s) => ({
      activeTripId: s.activeTripId,
      isStarting: s.isStarting,
      startError: s.startError,
      gpsProblem: s.gpsProblem,
      startDuty: s.startDuty,
      endDuty: s.endDuty,
    })),
  );
  const trip = useNetworkStore((s) => s.agentTrips.find((t) => t.id === activeTripId));
  const [name, setName] = useState(() => readJson<string>(LAST_AGENT_KEY, '', (v) => typeof v === 'string'));

  const begin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('warning', 'Agent Name Required', 'Enter your name before starting duty.');
      return;
    }
    writeJson(LAST_AGENT_KEY, name.trim());
    await startDuty(name);
  };

  const finish = async () => {
    const confirmed = await requestConfirm({
      title: 'End duty',
      message: 'Tracking stops now and this duty goes into the report.',
      confirmLabel: 'End duty',
      tone: 'danger',
    });
    if (confirmed) endDuty();
  };

  if (!trip) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Start duty</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Your location is recorded from Start Duty until End Duty, and only during that time.
        </p>
        <form onSubmit={begin} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label htmlFor="agent-name" className="mb-1 block text-xs font-medium text-slate-600">
              Agent name
            </label>
            <input
              id="agent-name"
              list="agent-name-options"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <datalist id="agent-name-options">
              {agentNames.map((agent) => (
                <option key={agent} value={agent} />
              ))}
            </datalist>
          </div>
          <button
            type="submit"
            disabled={isStarting}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            {isStarting ? 'Checking GPS…' : 'Start Duty'}
          </button>
        </form>
        {startError && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
            <p className="font-semibold">{GPS_HELP[startError].title}</p>
            <p className="mt-0.5">{GPS_HELP[startError].steps}</p>
          </div>
        )}
      </section>
    );
  }

  const summary = summarizeAgentTrip(trip);
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{trip.agentName} is on duty</h2>
          <p className="text-[13px] text-slate-600">
            Started {formatTime(trip.startTime)}. Last location {formatTime(trip.lastContactAt)}. Keep this page open with
            the screen on.
          </p>
        </div>
        <button
          type="button"
          onClick={finish}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700"
        >
          <Square className="h-4 w-4" /> End Duty
        </button>
      </div>
      {gpsProblem && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          {gpsProblem}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Distance" value={`${summary.distanceKm.toFixed(2)} km`} />
        <Metric label="Duty time" value={formatDuration(summary.durationMs)} />
        <Metric label="Stops" value={summary.stopCount} />
        <Metric label="GPS interruptions" value={summary.gapCount} />
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <TripTimeline trip={trip} assets={assets} editable />
      </div>
    </section>
  );
}

export const AgentTrackingView: React.FC = () => {
  const { trips, equipment, customers, workOrders } = useNetworkStore(
    useShallow((s) => ({
      trips: s.agentTrips,
      equipment: s.equipment,
      customers: s.customers,
      workOrders: s.workOrders,
    })),
  );
  const [agentFilter, setAgentFilter] = useState('All');
  const [today] = useState(() => localDay(new Date()));
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const assets = useMemo<TrackedAsset[]>(
    () =>
      [...equipment, ...customers].map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
    [equipment, customers],
  );
  const tripAgents = useMemo(() => [...new Set(trips.map((t) => t.agentName))].sort(), [trips]);
  const agentNames = useMemo(() => {
    const assigned = workOrders.map((w) => w.technicianName).filter(Boolean);
    return [...new Set([...tripAgents, ...assigned])].sort();
  }, [tripAgents, workOrders]);

  const visibleTrips = useMemo(
    () =>
      trips
        .filter((t) => {
          const day = localDay(t.startTime);
          return (agentFilter === 'All' || t.agentName === agentFilter) && day >= fromDay && day <= toDay;
        })
        .sort((a, b) => b.startTime.localeCompare(a.startTime)),
    [trips, agentFilter, fromDay, toDay],
  );

  // Refreshes a running duty's displayed totals even while no new location has arrived.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const exportName = `agent_tracking_${fromDay}_to_${toDay}`;

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex items-center gap-2.5">
          <MapPinned className="h-5 w-5 text-blue-700" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Agent Tracking</h1>
            <p className="text-[13px] text-slate-500">Duty routes, stops and GPS interruptions for field agents</p>
          </div>
        </header>

        <DutyCard assets={assets} agentNames={agentNames} />

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Daily report</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="report-agent" className="mb-1 block text-xs font-medium text-slate-600">
                  Agent
                </label>
                <select id="report-agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className={inputClass}>
                  <option value="All">All agents</option>
                  {tripAgents.map((agent) => (
                    <option key={agent} value={agent}>
                      {agent}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="report-from" className="mb-1 block text-xs font-medium text-slate-600">
                  From
                </label>
                <input id="report-from" type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="report-to" className="mb-1 block text-xs font-medium text-slate-600">
                  To
                </label>
                <input id="report-to" type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={inputClass} />
              </div>
              <button
                type="button"
                disabled={visibleTrips.length === 0}
                onClick={() => downloadFile(buildAgentReportCsv(visibleTrips, assets), 'text/csv', `${exportName}.csv`)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> CSV
              </button>
              <button
                type="button"
                disabled={visibleTrips.length === 0}
                onClick={() => exportAgentReportPdf(visibleTrips, assets, `${exportName}.pdf`)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <FileText className="h-4 w-4" /> PDF
              </button>
            </div>
          </div>

          {visibleTrips.length === 0 ? (
            <p className="mt-6 pb-4 text-center text-[13px] text-slate-500">
              No duties for these filters. Completed and running duties appear here.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Agent</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Duty</th>
                    <th className="py-2 pr-3 text-right font-medium">Distance</th>
                    <th className="py-2 pr-3 text-right font-medium">Moving</th>
                    <th className="py-2 pr-3 text-right font-medium">Stopped</th>
                    <th className="py-2 pr-3 text-right font-medium">Stops</th>
                    <th className="py-2 text-right font-medium">GPS gaps</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrips.map((trip) => {
                    const s = summarizeAgentTrip(trip);
                    const expanded = expandedId === trip.id;
                    return (
                      <React.Fragment key={trip.id}>
                        <tr className="border-b border-slate-100">
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : trip.id)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {trip.agentName}
                            </button>
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{formatDate(trip.startTime)}</td>
                          <td className="py-2 pr-3 tabular-nums text-slate-600">
                            {formatTime(trip.startTime)} – {trip.endTime ? formatTime(trip.endTime) : 'on duty'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{s.distanceKm.toFixed(2)} km</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatDuration(s.movingMs)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatDuration(s.stoppedMs)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{s.stopCount}</td>
                          <td className={`py-2 text-right tabular-nums ${s.gapCount > 0 ? 'font-semibold text-red-700' : ''}`}>
                            {s.gapCount}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-slate-100 bg-slate-50/70">
                            <td colSpan={8} className="p-3">
                              <TripTimeline trip={trip} assets={assets} editable={false} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
