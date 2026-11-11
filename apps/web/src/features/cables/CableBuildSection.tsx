import { useState } from 'react';
import { Layers } from 'lucide-react';

import {
  type Cable,
  CABLE_INSTALLATION_TYPES,
  CABLE_SHEATH_LABELS,
  CABLE_SHEATHS,
  cableBuildProblem,
  type CableInstallationType,
  type CableSheath,
  FIBER_MODE_LABELS,
  FIBER_MODES,
  FIBER_STANDARDS,
  type FiberMode,
  type FiberStandard,
  modeForStandard,
} from '@fibergis/shared';

import { Button, Input, KeyValueList, Select } from '../../components/ui';
import { InspectorSection } from '../inspector/sections';
import { type BuildValue, fiberStandardLabel, INSTALL_LABELS } from './cableLabels';
import { saveCableBuildDetails } from './cableRouteActions';

const NOT_RECORDED = 'Not recorded';

/** Choices for "how the cable is made", shared by the cable panel and the cable wizard. Blank = not recorded. */
export function CableBuildFields({
  value,
  onChange,
  coax,
  idPrefix,
}: {
  value: BuildValue;
  onChange: (next: BuildValue) => void;
  coax: boolean;
  idPrefix: string;
}) {
  // The typed text is kept as typed (such as "8."); the form opens afresh each time, so no sync is needed.
  const [diameter, setDiameter] = useState(value.outerDiameterMm !== undefined ? String(value.outerDiameterMm) : '');
  const implied = modeForStandard(value.fiberStandard);
  const label = 'mb-1 block text-[13px] font-semibold text-slate-700';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {!coax && (
        <>
          <div>
            <label htmlFor={`${idPrefix}-standard`} className={label}>
              Fibre standard
            </label>
            <Select id={`${idPrefix}-standard`} className="min-h-[48px]" value={value.fiberStandard ?? ''} onChange={(e) => onChange({ ...value, fiberStandard: (e.target.value || undefined) as FiberStandard | undefined })}>
              <option value="">{NOT_RECORDED}</option>
              {FIBER_STANDARDS.map((s) => (
                <option key={s} value={s}>
                  {fiberStandardLabel(s)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-mode`} className={label}>
              Mode
            </label>
            <Select id={`${idPrefix}-mode`} className="min-h-[48px]" value={value.fiberMode ?? ''} onChange={(e) => onChange({ ...value, fiberMode: (e.target.value || undefined) as FiberMode | undefined })}>
              <option value="">{NOT_RECORDED}</option>
              {FIBER_MODES.map((m) => (
                <option key={m} value={m}>
                  {FIBER_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
            {implied && !value.fiberMode && (
              <button type="button" className="mt-1 min-h-[40px] text-left text-[12px] font-semibold text-blue-700" onClick={() => onChange({ ...value, fiberMode: implied })}>
                {value.fiberStandard} is {FIBER_MODE_LABELS[implied].toLowerCase()}. Tap to record it.
              </button>
            )}
          </div>
        </>
      )}
      <div>
        <label htmlFor={`${idPrefix}-sheath`} className={label}>
          Outer jacket (sheath)
        </label>
        <Select id={`${idPrefix}-sheath`} className="min-h-[48px]" value={value.sheath ?? ''} onChange={(e) => onChange({ ...value, sheath: (e.target.value || undefined) as CableSheath | undefined })}>
          <option value="">{NOT_RECORDED}</option>
          {CABLE_SHEATHS.map((s) => (
            <option key={s} value={s}>
              {CABLE_SHEATH_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-diameter`} className={label}>
          Outside diameter (mm)
        </label>
        <Input
          id={`${idPrefix}-diameter`}
          inputMode="decimal"
          className="min-h-[48px]"
          placeholder={NOT_RECORDED}
          value={diameter}
          onChange={(e) => {
            setDiameter(e.target.value);
            const n = Number(e.target.value);
            onChange({ ...value, outerDiameterMm: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined });
          }}
        />
        <span className="mt-0.5 block text-[12px] text-slate-500">From the datasheet. Used for duct fill.</span>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-install`} className={label}>
          How it is installed
        </label>
        <Select id={`${idPrefix}-install`} className="min-h-[48px]" value={value.installationType ?? ''} onChange={(e) => onChange({ ...value, installationType: (e.target.value || undefined) as CableInstallationType | undefined })}>
          <option value="">{NOT_RECORDED}</option>
          {CABLE_INSTALLATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {INSTALL_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** Phase 5: how the cable is made, kept apart from what it is for (its type) and how it is installed. */
export function CableBuildSection({ cable }: { cable: Cable }) {
  const coax = cable.cableCategory === 'Coaxial';
  const fromCable = (): BuildValue => ({
    fiberStandard: cable.fiberStandard,
    fiberMode: cable.fiberMode,
    sheath: cable.sheath,
    outerDiameterMm: cable.outerDiameterMm,
    installationType: cable.installationType,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fromCable);
  const problem = cableBuildProblem({ ...draft, cableCategory: cable.cableCategory, type: cable.type });

  const items = [
    ...(coax
      ? []
      : [
          { label: 'Fibre standard', value: cable.fiberStandard ? fiberStandardLabel(cable.fiberStandard) : NOT_RECORDED },
          { label: 'Mode', value: cable.fiberMode ? FIBER_MODE_LABELS[cable.fiberMode] : NOT_RECORDED },
        ]),
    { label: 'Outer jacket', value: cable.sheath ? CABLE_SHEATH_LABELS[cable.sheath] : NOT_RECORDED },
    { label: 'Outside diameter', value: cable.outerDiameterMm ? `${cable.outerDiameterMm} mm` : NOT_RECORDED },
    { label: 'How it is installed', value: cable.installationType ? INSTALL_LABELS[cable.installationType] : NOT_RECORDED },
  ];

  return (
    <InspectorSection title="How it is made" icon={Layers} defaultOpen={false}>
      {!editing ? (
        <div className="space-y-2">
          <KeyValueList items={items} />
          <Button
            className="min-h-[48px] w-full"
            onClick={() => {
              setDraft(fromCable());
              setEditing(true);
            }}
            data-testid="cable-build-edit"
          >
            Change these details
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <CableBuildFields value={draft} onChange={setDraft} coax={coax} idPrefix={`build-${cable.id}`} />
          {problem && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              {problem}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button className="min-h-[48px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="min-h-[48px]"
              disabled={!!problem}
              onClick={() => {
                if (saveCableBuildDetails(cable.id, { ...draft, manufacturer: cable.manufacturer, model: cable.model })) setEditing(false);
              }}
              data-testid="cable-build-save"
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </InspectorSection>
  );
}
