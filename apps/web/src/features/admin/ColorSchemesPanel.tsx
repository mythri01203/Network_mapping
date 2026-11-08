import { useState } from 'react';

import { colorSchemeSettingId, formatColorSchemeSetting, parseColorSchemeSetting, schemeColorAt } from '@fibergis/shared';

import { Button, Field, Input } from '../../components/ui';
import { logAudit } from '../../stores/networkActions';
import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Fiber colour schemes. Built-in ones show their source; the operator adds the order printed on a
 * drum sheet. A cable uses a scheme only when someone records it on the cable.
 */
export function ColorSchemesPanel() {
  const schemes = useNetworkStore(selectColorSchemes);
  const role = useUiStore((s) => s.userRole);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [colors, setColors] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const id = colorSchemeSettingId(key.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
    const value = formatColorSchemeSetting(name || key, colors.split(',').map((c) => c.trim()).filter(Boolean));
    if (!parseColorSchemeSetting(id, value, source) || schemes.some((s) => s.builtIn && `fiber.scheme.${s.id}` === id)) {
      setError('Give a short key and at least two colours, separated by commas.');
      return;
    }
    setError(null);
    useNetworkStore.getState().saveSetting({ id, value, source: source.trim() || undefined, updatedAt: new Date().toISOString(), updatedBy: role });
    logAudit('SETTING_CHANGED', `Colour scheme ${id}: ${value}${source.trim() ? ` (${source.trim()})` : ''}`, id, 'System');
    showToast('success', 'Colour scheme saved', `${name || key} can now be chosen on a cable.`);
    setKey('');
    setName('');
    setColors('');
    setSource('');
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs" data-testid="color-schemes">
      <h4 className="mb-1 text-xs font-bold uppercase text-slate-700">Fiber colour schemes</h4>
      <p className="mb-3 text-xs text-slate-500">
        Colours are shown on a cable only when its scheme is recorded. No TEC or BSNL table was found, so check each maker's drum sheet.
      </p>
      <ul className="mb-3 space-y-2">
        {schemes.map((s) => (
          <li key={s.id} className="rounded-md border border-slate-100 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{s.name}</span>
              <span className="flex gap-0.5">
                {s.colors.map((c, i) => (
                  <span key={c + i} title={`${i + 1}. ${c}`} className="h-3 w-3 rounded-sm border border-black/20" style={{ backgroundColor: schemeColorAt(s, i + 1)?.hex }} />
                ))}
              </span>
              {!s.builtIn && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    useNetworkStore.getState().deleteSetting(colorSchemeSettingId(s.id));
                    logAudit('SETTING_RESET', `Colour scheme ${s.id} removed`, colorSchemeSettingId(s.id), 'System');
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-0.5 text-slate-500">{s.colors.length ? s.colors.join(', ') : 'No colours'}. {s.source}</p>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Short key">
          <Input data-testid="scheme-key" value={key} placeholder="maker-a" onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Name">
          <Input data-testid="scheme-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Colours in order" className="sm:col-span-2" error={error ?? undefined}>
          <Input data-testid="scheme-colors" value={colors} placeholder="Red, Green, Blue, …" onChange={(e) => setColors(e.target.value)} />
        </Field>
        <Field label="Source" className="sm:col-span-3">
          <Input data-testid="scheme-source" value={source} placeholder="Drum sheet, maker, date" onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Button size="sm" variant="primary" data-testid="scheme-save" className="self-end" onClick={save}>
          Add scheme
        </Button>
      </div>
    </section>
  );
}
