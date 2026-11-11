import { type ReactNode, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Info, MapPin, Route as RouteIcon } from 'lucide-react';

import {
  checkPositions,
  describeMapping,
  type FieldMapping,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  IMPORT_FORMAT_LABELS,
  importMappingProblem,
  KML_LINE_TARGETS,
  KML_POINT_TARGETS,
  type KmlGroup,
  type KmlGroupChoice,
  type KmlImportPlan,
  type KmlTarget,
  planKmlImport,
  POSITION_FIELDS,
  previewKml,
  previewSourceRows,
  resolveValidationSettings,
  type SourcePreview,
  sourceColumns,
  suggestMapping,
} from '@fibergis/shared';

import { Button, Checkbox, Select } from '../../components/ui';
import { ImportReadError, type LoadedMapFile, MAP_FILE_ACCEPT, readMapFile } from '../../lib/fileImport';
import { KmlReadError } from '../../lib/kmlImport';
import { useMapStore } from '../../stores/mapStore';
import { getNetworkData, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { applyKmlImport } from '../../stores/ospActions';

const CORE_COUNTS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288];

type Step = 'file' | 'columns' | 'groups' | 'check' | 'done';

interface Done {
  equipment: number;
  cables: number;
  ducts: number;
  skipped: number;
  endsConfirmed: number;
}

const STEP_TITLES: Record<Exclude<Step, 'done'>, string> = {
  file: 'Choose the file',
  columns: 'Match the columns',
  groups: 'Say what each group is',
  check: 'Check and import',
};

/**
 * Import a map file one step at a time: choose it, match its columns (GeoJSON, CSV, Shapefile),
 * say what each group is, then check what looks like something already on the map and which line
 * ends to connect. Nothing is guessed and nothing is connected that the person did not tick.
 */
export function ImportWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('file');
  const [loaded, setLoaded] = useState<LoadedMapFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [noPrjAccepted, setNoPrjAccepted] = useState(false);
  const [choices, setChoices] = useState<Record<string, KmlGroupChoice>>({});
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [confirmedEnds, setConfirmedEnds] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Done | null>(null);
  const settings = useNetworkStore(selectOspSettings);
  const settingRecords = useNetworkStore((s) => s.settings);
  const equipment = useNetworkStore((s) => s.equipment);
  const cables = useNetworkStore((s) => s.cables);
  const ducts = useNetworkStore((s) => s.ducts);

  const isTable = loaded !== null && loaded.format !== 'kml' && loaded.format !== 'kmz';
  const columns = useMemo(() => (loaded && 'rows' in loaded ? sourceColumns(loaded.rows) : []), [loaded]);
  const layers = useMemo(() => (loaded && 'layers' in loaded ? loaded.layers : []), [loaded]);
  const noPrjLayers = useMemo(() => layers.filter((l) => l.crs === 'no_prj'), [layers]);
  const refusedLayers = layers.filter((l) => l.crs === 'refused');
  const reprojected = layers.filter((l) => l.crs === 'reprojected');
  const mappingIssue = loaded && isTable ? importMappingProblem(loaded.format, mapping, columns) : null;

  const preview: SourcePreview | null = useMemo(() => {
    if (!loaded) return null;
    if ('features' in loaded) return { ...previewKml(loaded.features), badCoreCounts: 0, positions: checkPositions(loaded.features) };
    return previewSourceRows(loaded.rows, mapping, loaded.format);
  }, [loaded, mapping]);

  const settingsUsed = useMemo(() => {
    if (!loaded) return {};
    const used: Record<string, string> = { 'File kind': IMPORT_FORMAT_LABELS[loaded.format] };
    if (isTable) Object.assign(used, describeMapping(loaded.format, mapping));
    if (loaded.format === 'shapefile') {
      for (const l of loaded.layers) {
        used[`Coordinate system of layer "${l.name}"`.slice(0, 120)] =
          l.crs === 'wgs84' ? 'WGS 84, used as it is' : l.crs === 'reprojected' ? `converted to WGS 84 from ${l.crsName}` : l.crs === 'no_prj' ? 'no .prj: the person said it is WGS 84' : `not imported: ${l.crsName ?? 'not known'}`;
      }
    } else if (loaded.format === 'geojson' || loaded.format === 'csv') used['Coordinate system'] = 'WGS 84 latitude and longitude (the only one read)';
    return used;
  }, [loaded, isTable, mapping]);

  const overrides = useMemo(() => (noPrjLayers.length > 0 && noPrjAccepted ? [`Shapefile layer(s) ${noPrjLayers.map((l) => `"${l.name}"`).join(', ')} had no .prj; the person said the positions are WGS 84.`] : []), [noPrjLayers, noPrjAccepted]);

  const endSearchMeters = useMemo(() => resolveValidationSettings(settingRecords ?? []).cableEndGapMeters, [settingRecords]);

  const plan: KmlImportPlan | null = useMemo(
    () =>
      loaded && preview
        ? planKmlImport({ ...getNetworkData(), equipment, cables, ducts }, preview, choices, {
            fileName: loaded.fileName,
            format: loaded.format,
            includePossibleDuplicates: includeDuplicates,
            settings,
            settingsUsed,
            overrides,
            confirmedEnds,
            endSearchMeters,
          })
        : null,
    // The plan makes new random IDs, so it is rebuilt only when an input changes.
    [loaded, preview, choices, includeDuplicates, settings, settingsUsed, overrides, confirmedEnds, endSearchMeters, equipment, cables, ducts],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setReadError(null);
    setLoaded(null);
    setChoices({});
    setConfirmedEnds({});
    setNoPrjAccepted(false);
    try {
      const read = await readMapFile(file);
      setLoaded(read);
      if ('rows' in read) {
        if (read.rows.length === 0) throw new ImportReadError('No rows were found in this file.');
        setMapping(suggestMapping(sourceColumns(read.rows), read.format));
        setStep('columns');
      } else setStep('groups');
    } catch (error) {
      setLoaded(null);
      setReadError(error instanceof ImportReadError || error instanceof KmlReadError ? error.message : 'This file could not be read. Check that it is a KML, KMZ, GeoJSON, CSV or zipped Shapefile.');
    } finally {
      setReading(false);
    }
  };

  const doImport = () => {
    if (!plan) return;
    const result = applyKmlImport(plan);
    if (!result) return;
    setDone({ ...result, skipped: plan.skipped.length, endsConfirmed: plan.endsConfirmed });
    setStep('done');
    const first = plan.equipment[0] ?? null;
    const firstLine = plan.cables[0]?.coordinates[0] ?? plan.ducts[0]?.coordinates[0];
    if (first) useMapStore.getState().flyTo(first.lat, first.lng, 16);
    else if (firstLine) useMapStore.getState().flyTo(firstLine[0], firstLine[1], 16);
  };

  const setChoice = (key: string, patch: Partial<KmlGroupChoice>) => setChoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const itemCount = plan ? plan.equipment.length + plan.cables.length + plan.ducts.length : 0;
  const order: Step[] = isTable ? ['file', 'columns', 'groups', 'check'] : ['file', 'groups', 'check'];
  const back = () => setStep(order[Math.max(0, order.indexOf(step) - 1)] ?? 'file');

  if (step === 'done' && done) {
    return (
      <div className="space-y-3" data-testid="kml-done">
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 size={20} />
          <span className="text-[15px] font-semibold">Imported</span>
        </div>
        <p className="text-[13px] text-slate-700">
          {done.equipment} point(s), {done.cables} cable(s) and {done.ducts} duct(s) were added. {done.skipped} item(s) from the file were not imported.
        </p>
        <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px] text-slate-700">
          {done.endsConfirmed > 0 ? `${done.endsConfirmed} line end(s) were connected because you ticked them. ` : 'No line ends were connected. '}
          No spans or pole attachments were made, and positions are marked as imported with unknown accuracy. The whole import is kept under
          “Past imports”, where it can be undone in one go while nothing else uses its items.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose} data-testid="kml-close">
            Done
          </Button>
        </div>
      </div>
    );
  }

  const stepNumber = order.indexOf(step) + 1;
  return (
    <div className="space-y-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500" data-testid="import-step">
        Step {stepNumber} of {order.length}: {STEP_TITLES[step as Exclude<Step, 'done'>]}
      </p>

      {step === 'file' && (
        <>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 p-4 hover:border-blue-400">
            <FileUp className="shrink-0 text-slate-400" />
            <span className="text-[13px] text-slate-700">{reading ? 'Reading…' : 'Choose a file: KML, KMZ, GeoJSON, CSV, or a Shapefile in a .zip'}</span>
            <input type="file" accept={MAP_FILE_ACCEPT} className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="kml-file" />
          </label>
          <p className="text-[12px] text-slate-500">You will see everything before anything is saved. Positions must be latitude and longitude (WGS 84); a Shapefile in another known system is converted.</p>
        </>
      )}
      {readError && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-[13px] text-red-800" data-testid="kml-error">
          {readError}
        </p>
      )}

      {loaded && step === 'columns' && (
        <div className="space-y-3" data-testid="import-columns">
          <p className="text-[13px] text-slate-700">
            {loaded.fileName}: {'rows' in loaded ? loaded.rows.length : 0} row(s) and {columns.length} column(s). Choose which column holds what. Columns you do not choose are still kept with each item, as written.
          </p>
          {reprojected.map((l) => (
            <Notice key={l.name} tone="info">
              Layer “{l.name}” is in {l.crsName}. It was converted to latitude and longitude (WGS 84).
            </Notice>
          ))}
          {refusedLayers.map((l) => (
            <Notice key={l.name} tone="error">
              {l.message}
            </Notice>
          ))}
          {noPrjLayers.length > 0 && (
            <Notice tone="warning">
              {noPrjLayers.map((l) => l.message).join(' ')}
              <div className="mt-2">
                <Checkbox label="I know these positions are WGS 84 latitude and longitude" checked={noPrjAccepted} onChange={(e) => setNoPrjAccepted(e.target.checked)} data-testid="import-noprj-ok" />
              </div>
            </Notice>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.filter((f) => loaded.format === 'csv' || !POSITION_FIELDS.includes(f)).map((field) => (
              <label key={field} className="flex flex-col gap-1 text-[12px] font-medium text-slate-700">
                {IMPORT_FIELD_LABELS[field]}
                {(field === 'lat' || field === 'lng') && <span className="font-normal text-slate-500">Needed, unless you choose the WKT column</span>}
                <Select value={mapping[field] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))} data-testid={`import-map-${field}`}>
                  <option value="">Not used</option>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key}
                      {c.samples.length ? ` (e.g. ${c.samples.slice(0, 2).join(', ')})` : ' (empty)'}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          {mappingIssue ? (
            <Notice tone="warning">{mappingIssue}</Notice>
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px] text-slate-700" data-testid="import-mapping-summary">
              <p className="font-semibold">Your choices</p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(describeMapping(loaded.format, mapping)).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {loaded && preview && plan && step === 'groups' && (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-700" data-testid="kml-summary">
            {preview.total} item(s) found: {preview.features.length} can be imported in {preview.groups.length} group(s), {preview.skipped.length} cannot. Say what each group is. Nothing is guessed:
            names, descriptions and extra data are kept as written, and lengths are worked out from the lines.
          </p>
          {preview.positions.message && <Notice tone="warning">{preview.positions.message}</Notice>}
          {preview.badCoreCounts > 0 && <Notice tone="info">{preview.badCoreCounts} row(s) have a core count that is not a whole number. Their core count is left as not recorded.</Notice>}
          {preview.groups.length === 0 && <Notice tone="warning">Nothing in this file can be imported. See the reasons below.</Notice>}
          <div className="space-y-2">
            {preview.groups.map((group) => (
              <GroupRow key={group.key} group={group} choice={choices[group.key] ?? {}} onChange={(patch) => setChoice(group.key, patch)} />
            ))}
          </div>
          <SkippedList preview={preview} />
        </div>
      )}

      {loaded && plan && step === 'check' && (
        <div className="space-y-3" data-testid="import-check">
          {plan.possibleDuplicates.length + plan.possibleDuplicateLines.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="kml-duplicates">
              <p className="text-[13px] font-semibold text-amber-900">
                {plan.possibleDuplicates.length + plan.possibleDuplicateLines.length} item(s) look like ones already on the map.
              </p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[12px] text-amber-900">
                {plan.possibleDuplicates.map((d) => (
                  <li key={`p${d.index}`}>
                    {d.name}: {Math.round(d.distanceMeters)} m from {d.existing.name} (same kind)
                  </li>
                ))}
                {plan.possibleDuplicateLines.map((d) => (
                  <li key={`l${d.index}`}>
                    {d.name}: {d.overlapPercent}% of it runs along {d.collection === 'ducts' ? 'duct' : 'cable'} {d.existingName}
                  </li>
                ))}
              </ul>
              <Checkbox label="Import them as new items anyway" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} data-testid="kml-include-duplicates" />
              {!includeDuplicates && <p className="text-[11px] text-amber-800">Left unticked, they are not imported and the items on the map stay as they are.</p>}
            </div>
          )}

          {plan.endProposals.length > 0 && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="import-ends">
              <p className="text-[13px] font-semibold text-slate-800">Line ends near a box or chamber</p>
              <p className="text-[12px] text-slate-600">
                Being near does not prove a line ends there. Connect an end only if you know it does. Each end starts as “Leave it unconnected”.
              </p>
              <ul className="space-y-2">
                {plan.endProposals.map((p) => (
                  <li key={p.key} className="rounded-md bg-slate-50 p-2">
                    <p className="text-[12px] font-medium text-slate-800">
                      {p.lineName}: {p.end === 'start' ? 'first' : 'last'} end
                    </p>
                    <div className="mt-1 flex flex-col gap-1" role="radiogroup" aria-label={`${p.lineName} ${p.end} end`}>
                      <label className="flex min-h-[32px] items-center gap-2 text-[12px] text-slate-700">
                        <input type="radio" name={p.key} checked={!p.chosenRef} onChange={() => setConfirmedEnds((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== p.key)))} />
                        Leave it unconnected
                      </label>
                      {p.candidates.map((c) => (
                        <label key={c.ref} className="flex min-h-[32px] items-center gap-2 text-[12px] text-slate-700">
                          <input type="radio" name={p.key} checked={p.chosenRef === c.ref} onChange={() => setConfirmedEnds((prev) => ({ ...prev, [p.key]: c.ref }))} data-testid={`import-end-${p.key}-${c.id}`} />
                          Connect to {c.name} ({c.type}{c.inThisFile ? ', in this file' : ''}), {Math.round(c.distanceMeters)} m away
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px] text-slate-700">
            <p className="font-semibold">What will be added</p>
            <p>
              {plan.equipment.length} point(s), {plan.cables.length} cable(s), {plan.ducts.length} duct(s). {plan.skipped.length} item(s) are not imported.
              {plan.endsConfirmed > 0 ? ` ${plan.endsConfirmed} line end(s) will be connected because you chose them.` : ' No line ends will be connected.'}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer">What you chose (kept with the import)</summary>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(plan.settingsUsed).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
                {plan.overrides.map((o) => (
                  <li key={o} className="text-amber-800">
                    Accepted: {o}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}

      {step !== 'file' && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          <Button onClick={back} data-testid="import-back">
            Back
          </Button>
          {step === 'columns' && (
            <Button variant="primary" disabled={!!mappingIssue || (noPrjLayers.length > 0 && !noPrjAccepted)} onClick={() => setStep('groups')} data-testid="import-next">
              Next
            </Button>
          )}
          {step === 'groups' && (
            <Button variant="primary" disabled={!plan || plan.unanswered.length > 0 || preview?.groups.length === 0} onClick={() => setStep('check')} data-testid="import-next">
              {plan && plan.unanswered.length > 0 ? 'Say what each group is first' : 'Next'}
            </Button>
          )}
          {step === 'check' && (
            <Button variant="primary" disabled={!plan || itemCount === 0} onClick={doImport} data-testid="kml-import">
              {itemCount > 0 ? `Import ${itemCount} item(s)` : 'Nothing to import'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const styles = { info: 'border-blue-200 bg-blue-50 text-blue-900', warning: 'border-amber-300 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-800' }[tone];
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`flex gap-2 rounded-md border p-2 text-[12px] ${styles}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SkippedList({ preview }: { preview: SourcePreview }) {
  if (preview.skipped.length === 0) return null;
  return (
    <details className="rounded-lg border border-slate-200 p-2" data-testid="kml-skipped">
      <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">{preview.skipped.length} item(s) cannot be imported, and why</summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12px] text-slate-700">
        {preview.skipped.map((s) => (
          <li key={s.index}>
            <span className="font-medium">{s.name ?? `Item ${s.index + 1}`}</span>
            {s.folderPath ? <span className="text-slate-500"> ({s.folderPath})</span> : null}: {s.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function GroupRow({ group, choice, onChange }: { group: KmlGroup; choice: KmlGroupChoice; onChange: (patch: Partial<KmlGroupChoice>) => void }) {
  const targets = group.kind === 'point' ? KML_POINT_TARGETS : KML_LINE_TARGETS;
  const isCable = choice.target?.startsWith('cable:');
  const testKey = `${group.kind}-${group.folderPath || 'top'}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return (
    <div className="rounded-lg border border-slate-200 p-3" data-testid={`kml-group-${testKey}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 text-slate-500">{group.kind === 'point' ? <MapPin size={18} /> : <RouteIcon size={18} />}</span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="break-words text-[13px] font-semibold text-slate-900">
            {group.count} {group.kind === 'point' ? 'point(s)' : 'line(s)'} in {group.folderPath || 'the top of the file'}
          </div>
          <div className="break-words text-[11px] text-slate-500">
            {group.styleId ? `Style ${group.styleId}. ` : ''}
            {group.sampleNames.length ? `For example: ${group.sampleNames.join(', ')}.` : 'No names in the file.'}
            {group.extendedKeys.length ? ` Extra data kept: ${group.extendedKeys.join(', ')}.` : ''}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-64">
          <Select
            aria-label="What is this group?"
            value={choice.target ?? ''}
            onChange={(e) => onChange({ target: (e.target.value || undefined) as KmlTarget | undefined })}
            data-testid={`kml-target-${testKey}`}
          >
            <option value="">What are these?</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
            <option value="skip">Do not import</option>
          </Select>
          {choice.target && choice.target !== 'skip' && (
            <div className="flex gap-1" role="radiogroup" aria-label="Existing or planned">
              {(['existing', 'planned'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={choice.status === status}
                  onClick={() => onChange({ status })}
                  data-testid={`kml-status-${testKey}-${status}`}
                  className={`min-h-[36px] flex-1 rounded-md border text-[12px] font-medium ${
                    choice.status === status ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {status === 'existing' ? 'Already in the street' : 'Only planned'}
                </button>
              ))}
            </div>
          )}
          {isCable && (
            <Select aria-label="Core count" value={choice.coreCount?.toString() ?? ''} onChange={(e) => onChange({ coreCount: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Core count not recorded</option>
              {CORE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} cores
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
