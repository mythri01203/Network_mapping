import { useMemo, useState } from 'react';
import { CheckCircle2, FileUp, MapPin, Route as RouteIcon } from 'lucide-react';

import {
  KML_LINE_TARGETS,
  KML_POINT_TARGETS,
  type KmlGroup,
  type KmlGroupChoice,
  type KmlPreview,
  type KmlTarget,
  planKmlImport,
  previewKml,
} from '@fibergis/shared';

import { Button, Checkbox, Modal, Select } from '../../components/ui';
import { KmlReadError, parseKmlText, readKmlText } from '../../lib/kmlImport';
import { useMapStore } from '../../stores/mapStore';
import { getNetworkData, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { applyKmlImport } from '../../stores/ospActions';
import { useUiStore } from '../../stores/uiStore';

const CORE_COUNTS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288];

/** Import a KML or KMZ: preview, the person says what each group is, nothing is assumed or connected. */
export function KmlImportModal() {
  const open = useUiStore((s) => s.modals.kmlImport);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  if (!open) return null;
  return <KmlImport onClose={() => setModalOpen('kmlImport', false)} />;
}

interface Loaded {
  fileName: string;
  preview: KmlPreview;
}

function KmlImport({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [choices, setChoices] = useState<Record<string, KmlGroupChoice>>({});
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [done, setDone] = useState<{ equipment: number; cables: number; ducts: number; skipped: number } | null>(null);
  const settings = useNetworkStore(selectOspSettings);
  const equipment = useNetworkStore((s) => s.equipment);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setReadError(null);
    setLoaded(null);
    setChoices({});
    try {
      const features = parseKmlText(await readKmlText(file));
      if (features.length === 0) throw new KmlReadError('No placemarks were found in this file.');
      setLoaded({ fileName: file.name, preview: previewKml(features) });
    } catch (error) {
      setReadError(error instanceof KmlReadError ? error.message : 'This file could not be read as KML or KMZ.');
    } finally {
      setReading(false);
    }
  };

  const plan = useMemo(
    () =>
      loaded
        ? planKmlImport({ ...getNetworkData(), equipment }, loaded.preview, choices, {
            fileName: loaded.fileName,
            includePossibleDuplicates: includeDuplicates,
            settings,
          })
        : null,
    // The plan makes new random IDs, so it is rebuilt only when an input changes.
    [loaded, choices, includeDuplicates, settings, equipment],
  );

  const doImport = () => {
    if (!plan) return;
    const result = applyKmlImport(plan);
    if (!result) return;
    setDone({ ...result, skipped: plan.skipped.length });
    const first = plan.equipment[0] ?? null;
    const firstLine = plan.cables[0]?.coordinates[0] ?? plan.ducts[0]?.coordinates[0];
    if (first) useMapStore.getState().flyTo(first.lat, first.lng, 16);
    else if (firstLine) useMapStore.getState().flyTo(firstLine[0], firstLine[1], 16);
  };

  const setChoice = (key: string, patch: Partial<KmlGroupChoice>) => setChoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const footer = done ? (
    <Button variant="primary" onClick={onClose} data-testid="kml-close">
      Done
    </Button>
  ) : (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        disabled={!plan || plan.unanswered.length > 0 || plan.equipment.length + plan.cables.length + plan.ducts.length === 0}
        onClick={doImport}
        data-testid="kml-import"
      >
        {plan && plan.unanswered.length === 0
          ? `Import ${plan.equipment.length + plan.cables.length + plan.ducts.length} item(s)`
          : 'Say what each group is first'}
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title="Import KML or KMZ" icon={FileUp} size="xl" footer={footer}>
      {done ? (
        <div className="space-y-3" data-testid="kml-done">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={20} />
            <span className="text-[15px] font-semibold">Imported</span>
          </div>
          <p className="text-[13px] text-slate-700">
            {done.equipment} point(s), {done.cables} cable(s) and {done.ducts} duct(s) were added. {done.skipped} placemark(s) were not imported.
          </p>
          <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px] text-slate-700">
            Nothing was connected. No cable ends, spans or pole attachments were made, and positions are marked as imported with unknown
            accuracy. Connect and confirm things only where you know they are right. Undo removes the whole import.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 p-4 hover:border-blue-400">
            <FileUp className="text-slate-400" />
            <span className="text-[13px] text-slate-700">
              {reading ? 'Reading…' : loaded ? `${loaded.fileName}: choose another file` : 'Choose a .kml or .kmz file'}
            </span>
            <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="kml-file" />
          </label>
          {readError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-[13px] text-red-800" data-testid="kml-error">
              {readError}
            </p>
          )}

          {loaded && plan && (
            <>
              <p className="text-[13px] text-slate-700" data-testid="kml-summary">
                {loaded.preview.total} placemark(s) found: {loaded.preview.features.length} can be imported in {loaded.preview.groups.length} group(s),{' '}
                {loaded.preview.skipped.length} cannot. Say what each group is. Nothing is guessed: names, descriptions and extra data are kept as written,
                and lengths are worked out from the lines.
              </p>
              <div className="space-y-2">
                {loaded.preview.groups.map((group) => (
                  <GroupRow key={group.key} group={group} choice={choices[group.key] ?? {}} onChange={(patch) => setChoice(group.key, patch)} />
                ))}
              </div>

              {plan.unanswered.length === 0 && plan.possibleDuplicates.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="kml-duplicates">
                  <p className="text-[13px] font-semibold text-amber-900">
                    {plan.possibleDuplicates.length} point(s) look like items already on the map (same kind within {settings.duplicateRadiusMeters} m).
                  </p>
                  <ul className="max-h-32 overflow-y-auto text-[12px] text-amber-900">
                    {plan.possibleDuplicates.map((d) => (
                      <li key={d.index}>
                        {d.name}: {Math.round(d.distanceMeters)} m from {d.existing.name}
                      </li>
                    ))}
                  </ul>
                  <Checkbox
                    label="Import them as new items anyway"
                    checked={includeDuplicates}
                    onChange={(e) => setIncludeDuplicates(e.target.checked)}
                    data-testid="kml-include-duplicates"
                  />
                  {!includeDuplicates && <p className="text-[11px] text-amber-800">Left unticked, they are not imported and the existing items stay as they are.</p>}
                </div>
              )}

              {loaded.preview.skipped.length > 0 && (
                <details className="rounded-lg border border-slate-200 p-2" data-testid="kml-skipped">
                  <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">
                    {loaded.preview.skipped.length} placemark(s) cannot be imported, and why
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12px] text-slate-700">
                    {loaded.preview.skipped.map((s) => (
                      <li key={s.index}>
                        <span className="font-medium">{s.name ?? `Placemark ${s.index + 1}`}</span>
                        {s.folderPath ? <span className="text-slate-500"> ({s.folderPath})</span> : null}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
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
        <div className="min-w-[12rem] flex-1">
          <div className="text-[13px] font-semibold text-slate-900">
            {group.count} {group.kind === 'point' ? 'point(s)' : 'line(s)'} in {group.folderPath || 'the top of the file'}
          </div>
          <div className="text-[11px] text-slate-500">
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
                  className={`h-8 flex-1 rounded-md border text-[12px] font-medium ${
                    choice.status === status ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {status === 'existing' ? 'Already in the street' : 'Only planned'}
                </button>
              ))}
            </div>
          )}
          {isCable && (
            <Select
              aria-label="Core count"
              value={choice.coreCount?.toString() ?? ''}
              onChange={(e) => onChange({ coreCount: e.target.value ? Number(e.target.value) : undefined })}
            >
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
