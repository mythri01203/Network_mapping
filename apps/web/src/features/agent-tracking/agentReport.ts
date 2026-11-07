import jsPDF from 'jspdf';

import { type AgentTimelineEntry, type AgentTrip, agentTripTimeline, summarizeAgentTrip, type TrackedAsset } from '@fibergis/shared';

export const formatDuration = (milliseconds: number): string => {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export const formatTime = (time: number | string): string =>
  new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const formatDate = (time: string): string => new Date(time).toLocaleDateString();

/** The local calendar day of a time as `YYYY-MM-DD`, matching date inputs. */
export function localDay(time: string | number | Date): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function describeTimelineEntry(entry: AgentTimelineEntry): string {
  switch (entry.kind) {
    case 'start':
      return 'Duty started';
    case 'end':
      return 'Duty ended';
    case 'move':
      return `Moved ${entry.distanceKm.toFixed(2)} km`;
    case 'gap':
      return `GPS interrupted: ${entry.reason}`;
    case 'stop': {
      const place = entry.nearest
        ? `near ${entry.nearest.name} (${entry.nearest.id})`
        : `at ${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`;
      return `Stopped ${place}${entry.note ? `. Note: ${entry.note}` : ''}`;
    }
  }
}

/** Quotes a CSV cell and stops spreadsheet programs running typed text as a formula. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

const SUMMARY_HEADER = ['Agent', 'Date', 'Status', 'Duty start', 'Duty end', 'Duty time', 'Distance km', 'Moving time', 'Stopped time', 'Stops', 'GPS interruptions', 'Time without GPS'];

function summaryRow(trip: AgentTrip): (string | number)[] {
  const s = summarizeAgentTrip(trip);
  return [
    trip.agentName,
    localDay(trip.startTime),
    trip.status === 'active' ? 'On duty' : 'Completed',
    formatTime(trip.startTime),
    trip.endTime ? formatTime(trip.endTime) : '',
    formatDuration(s.durationMs),
    s.distanceKm.toFixed(2),
    formatDuration(s.movingMs),
    formatDuration(s.stoppedMs),
    s.stopCount,
    s.gapCount,
    formatDuration(s.gapMs),
  ];
}

export function buildAgentReportCsv(trips: readonly AgentTrip[], assets: readonly TrackedAsset[]): string {
  const rows: (string | number)[][] = [SUMMARY_HEADER, ...trips.map(summaryRow), [], ['Agent', 'Date', 'From', 'To', 'Duration', 'Activity']];
  for (const trip of trips) {
    for (const entry of agentTripTimeline(trip, assets)) {
      rows.push([
        trip.agentName,
        localDay(entry.startMs),
        formatTime(entry.startMs),
        formatTime(entry.endMs),
        formatDuration(entry.endMs - entry.startMs),
        describeTimelineEntry(entry),
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function exportAgentReportPdf(trips: readonly AgentTrip[], assets: readonly TrackedAsset[], filename: string): void {
  const doc = new jsPDF();
  const margin = 14;
  const lineHeight = 5;
  let y = 18;

  const write = (text: string, size = 9, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, 180) as string[]) {
      if (y > 282) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
  };

  write('Field Agent Tracking Report', 15, 'bold');
  write(`Generated ${new Date().toLocaleString()} · ${trips.length} dut${trips.length === 1 ? 'y' : 'ies'}`);
  y += lineHeight;

  for (const trip of trips) {
    const s = summarizeAgentTrip(trip);
    write(`${trip.agentName} · ${formatDate(trip.startTime)}`, 11, 'bold');
    write(
      `Duty ${formatTime(trip.startTime)} to ${trip.endTime ? formatTime(trip.endTime) : 'on duty'} (${formatDuration(s.durationMs)}) · ${s.distanceKm.toFixed(2)} km`,
    );
    write(
      `Moving ${formatDuration(s.movingMs)} · Stopped ${formatDuration(s.stoppedMs)} (${s.stopCount} stops) · ${s.gapCount} GPS interruptions (${formatDuration(s.gapMs)})`,
    );
    for (const entry of agentTripTimeline(trip, assets)) {
      write(`${formatTime(entry.startMs)}  ${describeTimelineEntry(entry)} (${formatDuration(entry.endMs - entry.startMs)})`);
    }
    y += lineHeight;
  }
  doc.save(filename);
}
