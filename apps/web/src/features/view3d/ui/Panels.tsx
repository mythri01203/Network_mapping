import React, { useId, useState } from 'react';
import { ChevronDown, CircleHelp, X } from 'lucide-react';

import type { FiberFilter } from '../engine/fibers';
import { type Lang3D, type Msg3DKey, t3d, tx } from '../i18n';
import { TIA598 } from '../scene/models';
import type { PresetKey } from '../scene/presets';
import type { ColorChip, CustomerPath, PonChip, PonSummary, Scene3D, SceneBox, SceneText } from '../scene/types';
import { mutedClass, panelClass, PRESET_ORDER, type Tone } from './style';

/** Panels of the 3D view. Every button has a visible label; colours always come with names. */

export function Btn({
  tone,
  on,
  onClick,
  children,
  sub,
  disabled,
  title,
  className = '',
}: {
  tone: Tone;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  sub?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const base = tone.dark
    ? 'border-white/15 hover:border-emerald-400 hover:text-emerald-300'
    : 'border-black/15 hover:border-emerald-600 hover:text-emerald-700';
  const active = tone.dark
    ? 'border-emerald-400 text-emerald-300 bg-emerald-400/10'
    : 'border-emerald-600 text-emerald-700 bg-emerald-50';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={title}
      className={`inline-flex min-h-[44px] flex-col items-start justify-center rounded-lg border px-3 py-1 text-left text-[13px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? active : base} ${className}`}
    >
      <span className="font-medium">{children}</span>
      {sub && <span className={`text-[10.5px] ${mutedClass(tone)}`}>{sub}</span>}
    </button>
  );
}

export function HelpBubble({ tone, text, label }: { tone: Tone; text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[44px] w-[44px] items-center justify-center rounded-full ${tone.dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-black/5'}`}
      >
        <CircleHelp size={18} />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={`absolute right-0 top-11 z-20 w-64 p-3 text-[12.5px] leading-snug ${panelClass(tone)}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Chip({ chip, tone, small }: { chip: ColorChip; tone: Tone; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 ${small ? 'text-[11px]' : 'text-[12px]'} ${tone.dark ? 'border-white/15' : 'border-black/10'}`}
    >
      <span
        className="inline-block h-3 w-3 rounded-sm ring-1 ring-black/20"
        style={{ background: chip.hex }}
        aria-hidden
      />
      {chip.name}
    </span>
  );
}

export function PresetPanel({
  tone,
  lang,
  active,
  available,
  onPreset,
}: {
  tone: Tone;
  lang: Lang3D;
  active: PresetKey | null;
  available: (k: PresetKey) => boolean;
  onPreset: (k: PresetKey) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t3d(lang, 'views')}
      className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible"
    >
      {PRESET_ORDER.map((k) => (
        <Btn
          key={k}
          tone={tone}
          on={active === k}
          disabled={!available(k)}
          onClick={() => onPreset(k)}
          sub={t3d(lang, `term.${k}` as Msg3DKey)}
          className="shrink-0"
        >
          {t3d(lang, `preset.${k}` as Msg3DKey)}
        </Btn>
      ))}
    </div>
  );
}

const filterKey = (f: FiberFilter) =>
  f.kind === 'level' ? `level:${f.level}` : f.kind === 'pon' ? `pon:${f.ponKey}` : f.kind;

/** A button on a card. `primary` draws it highlighted. */
export interface CardAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/** One fiber of a cable or one output of a splitter. */
export interface PortRow {
  key: string;
  n: number;
  chip?: ColorChip;
  /** "In use" or "FREE", in the person's language. */
  state: string;
  free: boolean;
  /** What it carries or who is on it, from the record. */
  text?: string;
}

/** Boxes with a free splitter output: tap one to go to it. */
export function FreePlaces({
  tone,
  lang,
  title,
  places,
  onGo,
}: {
  tone: Tone;
  lang: Lang3D;
  title: string;
  places: { id: string; name: string; free: number; total: number; ratio: string }[];
  onGo: (id: string) => void;
}) {
  const muted = mutedClass(tone);
  return (
    <section className="space-y-1">
      <div className="text-[13px] font-semibold">{t3d(lang, 'info.freePlaces')}</div>
      <div className={`text-[11px] ${muted}`}>{title}</div>
      {places.length === 0 ? (
        <p className={`text-[12px] ${muted}`}>{t3d(lang, 'info.freeNone')}</p>
      ) : (
        <ul className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
          {places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onGo(p.id)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-2 text-left text-[12.5px] ${
                  tone.dark ? 'border-white/15 hover:bg-white/10' : 'border-black/15 hover:bg-black/5'
                }`}
              >
                <span className="min-w-0 truncate">
                  {p.name} <span className={muted}>{p.ratio}</span>
                </span>
                <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 font-semibold text-emerald-700">
                  {p.free} {t3d(lang, 'info.freeOne')} / {p.total}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A label and its value; `tone` colours the value (bad = red, good = green). */
export type Fact = [label: string, value: string, tone?: 'good' | 'bad'];

export function Facts({ tone, facts }: { tone: Tone; facts?: Fact[] }) {
  if (!facts?.length) return null;
  const muted = mutedClass(tone);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[12.5px]">
      {facts.map(([label, value, kind]) => (
        <div key={label} className="contents">
          <dt className={muted}>{label}</dt>
          <dd className={kind === 'bad' ? 'font-semibold text-red-500' : kind === 'good' ? 'text-emerald-600' : ''}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The whole network in numbers, and every PON port with its customers and free ports. */
export function NetworkSummary({
  tone,
  lang,
  facts,
  pons,
  activePon,
  onPon,
}: {
  tone: Tone;
  lang: Lang3D;
  facts: Fact[];
  pons: PonChip[];
  activePon: string | null;
  onPon: (key: string) => void;
}) {
  const muted = mutedClass(tone);
  return (
    <section className="space-y-1.5">
      <div className="text-[13px] font-semibold">{t3d(lang, 'info.title')}</div>
      <Facts tone={tone} facts={facts} />
      {pons.length > 0 && (
        <div>
          <div className={`mb-1 text-[11px] uppercase tracking-wide ${muted}`}>{t3d(lang, 'info.ponList')}</div>
          <ul className="space-y-1">
            {pons.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  aria-pressed={activePon === p.key}
                  onClick={() => onPon(p.key)}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left text-[12px] leading-tight ${
                    activePon === p.key
                      ? 'border-emerald-600 bg-emerald-500/10'
                      : tone.dark
                        ? 'border-white/15 hover:bg-white/10'
                        : 'border-black/15 hover:bg-black/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-bold"
                        style={{ background: p.hex, color: p.ink }}
                      >
                        {p.id}
                      </span>
                      <span className="truncate font-semibold">{p.area}</span>
                    </span>
                    <span className={`shrink-0 font-semibold ${p.free > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {p.free} {t3d(lang, 'info.free')}
                    </span>
                  </div>
                  {p.streets.length > 0 && <div className={`truncate ${muted}`}>{p.streets.join(', ')}</div>}
                  <div className={muted}>
                    {p.active} {t3d(lang, 'info.active')} · {p.inactive} {t3d(lang, 'info.inactive')}
                    {p.rxRange && ` · Rx ~${p.rxRange.minDbm.toFixed(1)} … ${p.rxRange.maxDbm.toFixed(1)} dBm`}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={`text-[11px] ${muted}`}>{t3d(lang, 'info.dots')}</p>
    </section>
  );
}

export function MappingPanel({
  tone,
  lang,
  scene,
  pon,
  onPon,
  filter,
  onFilter,
}: {
  tone: Tone;
  lang: Lang3D;
  scene: Scene3D;
  pon: PonSummary | null;
  onPon: (key: string) => void;
  filter: FiberFilter;
  onFilter: (f: FiberFilter) => void;
}) {
  const muted = mutedClass(tone);
  const levels = pon?.levels ?? [];
  const branchLevels = levels.slice(0, -1).map((l) => l.level);
  const filters: { f: FiberFilter; label: string; sub: string }[] = [
    { f: { kind: 'all' }, label: t3d(lang, 'filter.all'), sub: '' },
    { f: { kind: 'feeder' }, label: t3d(lang, 'filter.feeder'), sub: t3d(lang, 'term.feeder') },
    ...branchLevels.map((n) => ({
      f: { kind: 'level', level: n } as FiberFilter,
      label: t3d(lang, 'filter.level', { n }),
      sub: t3d(lang, 'term.level', { n }),
    })),
    {
      f: { kind: 'drop' },
      label: t3d(lang, 'filter.drop'),
      sub: levels.length
        ? `${levels[levels.length - 1].ratios.join('/')} ${t3d(lang, 'term.drop')}`
        : t3d(lang, 'term.drop'),
    },
  ];
  return (
    <section aria-label={t3d(lang, 'fiberMap')} className="space-y-2">
      {scene.pons.length > 1 && (
        <label className="block text-[12px]">
          <span className={muted}>{t3d(lang, 'pon')}</span>
          <select
            value={pon?.key ?? ''}
            onChange={(e) => onPon(e.target.value)}
            className={`mt-1 block h-[44px] w-full rounded-lg border px-2 text-[13px] ${tone.dark ? 'border-white/15 bg-slate-900' : 'border-black/15 bg-white'}`}
          >
            {scene.pons.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} · {p.oltId} · {p.used}
              </option>
            ))}
          </select>
        </label>
      )}
      {pon ? (
        <div className="space-y-1 text-[12.5px]">
          <div className="font-semibold">
            {pon.label} → {pon.used} {t3d(lang, 'customers').toLowerCase()}
          </div>
          {levels.length > 0 && (
            <div className={muted}>
              {t3d(lang, 'cascade')}: {levels.map((l) => `${l.ratios.join('/')} ×${l.boxes}`).join(' → ')}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt className={muted}>{t3d(lang, 'designPorts')}</dt>
            <dd className="text-right font-medium">{pon.designPorts}</dd>
            <dt className={muted}>{t3d(lang, 'builtPorts')}</dt>
            <dd className="text-right font-medium">{pon.builtPorts}</dd>
            <dt className={muted}>{t3d(lang, 'used')}</dt>
            <dd className="text-right font-medium">{pon.used}</dd>
            <dt className={muted}>{t3d(lang, 'spare')}</dt>
            <dd className="text-right font-medium">{pon.spare}</dd>
          </dl>
          {pon.budget && (
            <div
              className={`rounded-lg border p-2 ${pon.budget.fits ? (tone.dark ? 'border-emerald-500/30' : 'border-emerald-600/30') : 'border-amber-500/60'}`}
            >
              <div className="flex justify-between font-medium">
                <span>{t3d(lang, 'loss')}</span>
                <span>
                  {pon.budget.totalLossDb} dB / {pon.budget.classMaxLossDb} dB ({pon.budget.opticsClass})
                </span>
              </div>
              <div className={`text-[11px] ${muted}`}>
                {t3d(lang, 'lossParts', {
                  s: pon.budget.splitterLossDb,
                  f: pon.budget.fiberLossDb,
                  m: pon.budget.distanceMeters,
                  c: pon.budget.connectors,
                  cd: pon.budget.connectorLossDb,
                  sp: pon.budget.spliceLossDb,
                })}
              </div>
              <div className="mt-0.5 text-[11.5px]">{tx(lang, pon.budget.recommendation)}</div>
            </div>
          )}
          {pon.warnings.map((w) => (
            <div
              key={w.key}
              role="alert"
              className="rounded-md bg-amber-500/15 px-2 py-1 text-[11.5px] text-amber-700 dark:text-amber-300"
            >
              ⚠ {tx(lang, w)}
            </div>
          ))}
          <div className={`text-[11px] ${muted}`}>
            {pon.source === 'fiber' ? t3d(lang, 'fromFiber') : t3d(lang, 'fromRecord')}
          </div>
        </div>
      ) : (
        <div className={`text-[12.5px] ${muted}`}>{t3d(lang, 'noPon')}</div>
      )}
      <div role="group" aria-label={t3d(lang, 'fiberMap')} className="flex flex-wrap gap-1.5">
        {filters.map(({ f, label, sub }) => (
          <Btn
            key={filterKey(f)}
            tone={tone}
            on={filterKey(filter) === filterKey(f)}
            onClick={() => onFilter(f)}
            sub={sub || undefined}
          >
            {label}
          </Btn>
        ))}
      </div>
    </section>
  );
}

export function FindHouse({
  tone,
  lang,
  onFind,
  max,
}: {
  tone: Tone;
  lang: Lang3D;
  onFind: (q: string) => boolean;
  max: number;
}) {
  const [q, setQ] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const id = useId();
  const go = () => {
    const ok = onFind(q);
    setMiss(ok ? null : q);
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[12.5px] font-semibold">
        {t3d(lang, 'find')}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder={t3d(lang, 'findHint')}
          inputMode="search"
          aria-describedby={`${id}-hint`}
          className={`h-[44px] min-w-0 flex-1 rounded-lg border px-2.5 text-[13px] ${tone.dark ? 'border-white/15 bg-slate-900 placeholder:text-slate-500' : 'border-black/15 bg-white placeholder:text-slate-400'}`}
        />
        <Btn tone={tone} onClick={go}>
          {t3d(lang, 'showFiber')}
        </Btn>
      </div>
      <div id={`${id}-hint`} className={`text-[11.5px] ${mutedClass(tone)}`}>
        1–{max} · {t3d(lang, 'orTap')}
      </div>
      {miss !== null && (
        <div role="alert" className="text-[12px] text-amber-600">
          {t3d(lang, 'notFound', { q: miss })}
        </div>
      )}
    </div>
  );
}

export function CustomerCard({
  tone,
  lang,
  path,
  others,
  facts,
  actions,
  onShow2d,
  onClose,
  onOther,
}: {
  tone: Tone;
  lang: Lang3D;
  path: CustomerPath;
  others: CustomerPath[];
  /** More recorded facts about the customer: status, plan, light level. */
  facts?: Fact[];
  /** Work that can be done on this record (edit, add a customer). */
  actions?: CardAction[];
  onShow2d?: () => void;
  onClose: () => void;
  onOther: (id: string) => void;
}) {
  const muted = mutedClass(tone);
  return (
    <section aria-live="polite" aria-label={t3d(lang, 'fiberPath')} className="space-y-1.5 text-[12.5px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold">
            {t3d(lang, 'house', { n: path.number })} · {path.name}
          </div>
          <div className={`text-[11px] ${muted}`}>{path.customerId}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t3d(lang, 'close')}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full hover:bg-black/10"
        >
          <X size={16} />
        </button>
      </div>
      <div>
        <div className={`text-[11px] uppercase tracking-wide ${muted}`}>{t3d(lang, 'fiberPath')}</div>
        <div className="font-medium leading-snug">{path.text}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {path.portColor && (
          <span className="inline-flex items-center gap-1">
            <span className={muted}>{t3d(lang, 'portColor')}:</span> <Chip chip={path.portColor} tone={tone} small />
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span className={muted}>{t3d(lang, 'fiberColor')}:</span>
          {path.fiberColor ? (
            <Chip chip={path.fiberColor} tone={tone} small />
          ) : (
            <span className="text-[11.5px]">{path.fiberColorNote}</span>
          )}
        </span>
      </div>
      <div className={`text-[11px] ${muted}`}>
        {path.source === 'fiber' ? t3d(lang, 'fromFiber') : t3d(lang, 'fromRecord')}
        {!path.complete && ` · ${t3d(lang, 'gaps')}`}
      </div>
      <Facts tone={tone} facts={facts} />
      <div className="text-[12px]">
        <span className={muted}>{t3d(lang, 'live')}: </span>
        <span className={path.live?.fault ? 'font-semibold text-red-500' : ''}>
          {path.live?.label ?? t3d(lang, 'noLive')}
        </span>
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {others.map((o) => (
            <Btn key={o.customerId} tone={tone} onClick={() => onOther(o.customerId)} sub={o.customerId}>
              {t3d(lang, 'house', { n: o.number })}
            </Btn>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {actions?.map((a) => (
          <Btn key={a.label} tone={tone} on={a.primary} onClick={a.onClick}>
            {a.label}
          </Btn>
        ))}
        {onShow2d && (
          <Btn tone={tone} onClick={onShow2d}>
            {t3d(lang, 'openIn2d')}
          </Btn>
        )}
      </div>
    </section>
  );
}

export function EquipmentCard({
  tone,
  lang,
  name,
  type,
  status,
  box,
  extra,
  facts,
  warning,
  rows,
  actions,
  onShow2d,
  onClose,
}: {
  tone: Tone;
  lang: Lang3D;
  name: string;
  type: string;
  status?: string;
  box?: SceneBox;
  extra?: string;
  /** More recorded facts: outputs used and free, customers served. */
  facts?: Fact[];
  /** What a failure here would mean, in plain words. */
  warning?: string;
  /** One row per fiber or splitter output: number, colour, used or free, what it carries. */
  rows?: { title: string; items: PortRow[] };
  /** Work that can be done on this record (edit, add a customer). */
  actions?: CardAction[];
  onShow2d?: () => void;
  onClose: () => void;
}) {
  const muted = mutedClass(tone);
  const used = box?.ports.filter((p) => p.state === 'used').length ?? 0;
  return (
    <section aria-live="polite" aria-label={t3d(lang, 'selected')} className="space-y-1 text-[12.5px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`text-[11px] uppercase tracking-wide ${muted}`}>{t3d(lang, 'selected')}</div>
          <div className="text-[14px] font-semibold">{name}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t3d(lang, 'close')}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full hover:bg-black/10"
        >
          <X size={16} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3">
        <dt className={muted}>{t3d(lang, 'type')}</dt>
        <dd>{type}</dd>
        {status && (
          <>
            <dt className={muted}>{t3d(lang, 'status')}</dt>
            <dd>{status}</dd>
          </>
        )}
        {box && box.ports.length > 0 && (
          <>
            <dt className={muted}>{t3d(lang, 'ports')}</dt>
            <dd>
              {used} / {box.ports.length}
            </dd>
          </>
        )}
        {box && box.splitters.length > 0 && (
          <>
            <dt className={muted}>{t3d(lang, 'splitters')}</dt>
            <dd>{box.splitters.map((s) => `${s.ratio}${s.level ? ` (L${s.level})` : ''}`).join(', ')}</dd>
          </>
        )}
      </dl>
      <Facts tone={tone} facts={facts} />
      {warning && <div className="rounded-md bg-amber-500/15 px-2 py-1 text-[12px] font-medium">{warning}</div>}
      {rows && rows.items.length > 0 && (
        <div>
          <div className={`mb-1 text-[11px] uppercase tracking-wide ${muted}`}>{rows.title}</div>
          <ul className="max-h-[240px] space-y-0.5 overflow-y-auto pr-1">
            {rows.items.map((r) => (
              <li key={r.key} className="flex items-center gap-1.5 text-[12px]">
                <span className="w-5 shrink-0 text-right tabular-nums">{r.n}</span>
                {r.chip && <Chip chip={r.chip} tone={tone} small />}
                <span
                  className={`shrink-0 rounded px-1 text-[11px] font-semibold ${
                    r.free ? 'bg-emerald-500/20 text-emerald-700' : tone.dark ? 'bg-white/10' : 'bg-black/10'
                  }`}
                >
                  {r.state}
                </span>
                <span className={`min-w-0 truncate ${muted}`} title={r.text}>
                  {r.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extra && <div className={`text-[11.5px] ${muted}`}>{extra}</div>}
      <div className="flex flex-wrap gap-1.5">
        {actions?.map((a) => (
          <Btn key={a.label} tone={tone} on={a.primary} onClick={a.onClick}>
            {a.label}
          </Btn>
        ))}
        {onShow2d && (
          <Btn tone={tone} onClick={onShow2d}>
            {t3d(lang, 'openIn2d')}
          </Btn>
        )}
      </div>
    </section>
  );
}

export function Legend({ tone, lang }: { tone: Tone; lang: Lang3D }) {
  const [open, setOpen] = useState(false);
  const muted = mutedClass(tone);
  const row = (hex: string, label: Msg3DKey, term?: Msg3DKey) => (
    <li className="flex items-center gap-2">
      <span
        className="inline-block h-3 w-5 shrink-0 rounded-sm ring-1 ring-black/20"
        style={{ background: hex }}
        aria-hidden
      />
      <span>
        {t3d(lang, label)}
        {term && <span className={`ml-1 text-[10.5px] ${muted}`}>{t3d(lang, term)}</span>}
      </span>
    </li>
  );
  return (
    <section className="text-[12px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between font-semibold"
      >
        {t3d(lang, 'legend')}
        <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <ul className="space-y-1">
          {row('#f2c500', 'legend.feeder', 'legend.feederTerm')}
          {row('#10b5c4', 'legend.uplink', 'legend.uplinkTerm')}
          {row('#1f5fff', 'legend.lan', 'legend.lanTerm')}
          <li>
            <div>{t3d(lang, 'legend.drops')}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {TIA598.map((c, i) => (
                <span key={c.name} className="inline-flex items-center">
                  <span className={`mr-0.5 text-[10px] ${muted}`}>{i + 1}</span>
                  <Chip chip={c} tone={tone} small />
                </span>
              ))}
            </div>
            <div className={`text-[10.5px] ${muted}`}>TIA-598</div>
          </li>
          {row('#7ee6ff', 'legend.down')}
          {row('#ffb347', 'legend.up')}
          {row('#ff3b3b', 'legend.fault')}
          {row('rgba(160,170,180,.5)', 'legend.schematic')}
        </ul>
      )}
    </section>
  );
}

export function Notes({ tone, lang, notes }: { tone: Tone; lang: Lang3D; notes: SceneText[] }) {
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  return (
    <section className="text-[12px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between font-semibold"
      >
        {t3d(lang, 'notes')} ({notes.length})
        <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <ul className={`list-disc space-y-1 pl-4 ${mutedClass(tone)}`}>
          {notes.map((n) => (
            <li key={n.key}>{tx(lang, n)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
