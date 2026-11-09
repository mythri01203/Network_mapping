import type { IngestResult } from '../../api/monitoringClient';

/**
 * What a file import did or would do. Row numbers are the file's data rows (the header is row 0).
 * The server numbers the rows it was sent, so they are mapped back to the file here.
 */
export function ImportPreview({ result, rowNumbers, localSkipped }: { result: IngestResult; rowNumbers: number[]; localSkipped: { row: number; reason: string }[] }) {
  const fileRow = (n: number) => rowNumbers[n - 1] ?? n;
  const skipped = [...localSkipped, ...result.skipped.map((s) => ({ row: fileRow(s.row), reason: s.reason }))].sort((a, b) => a.row - b.row);
  const unmatched = result.unmatched.map((u) => ({ ...u, row: fileRow(u.row) }));
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs" data-testid="mon-import-result">
      <div className="font-semibold" data-testid="mon-import-summary">
        {result.dryRun ? 'Preview (nothing stored yet): ' : 'Imported: '}
        {result.matched} row(s) match an ONT · {unmatched.length} not matched · {skipped.length} skipped · {result.duplicates} already stored ·{' '}
        {result.stored.readings} reading(s), {result.stored.statuses} status(es){result.dryRun ? ' would be stored' : ' stored'}
        {result.dryRun ? '' : ` · ${result.alarmsRaised} alarm(s) raised`}
      </div>
      {unmatched.length > 0 && (
        <div>
          <div className="font-semibold">Not matched (kept and listed, not shown on any customer)</div>
          <ul className="mt-1 space-y-0.5" data-testid="mon-import-unmatched">
            {unmatched.map((u) => (
              <li key={`${u.row}-${u.key}`}>
                Row {u.row}: <span className="font-mono">{u.key}</span> · {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skipped.length > 0 && (
        <div>
          <div className="font-semibold">Skipped (not stored)</div>
          <ul className="mt-1 space-y-0.5" data-testid="mon-import-skipped">
            {skipped.slice(0, 100).map((s, i) => (
              <li key={`${s.row}-${i}`}>
                Row {s.row}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
