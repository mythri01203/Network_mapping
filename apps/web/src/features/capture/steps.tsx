import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Delete, MapPinOff, Save, Search, Wrench, X } from 'lucide-react';

import {
  checkRxEntry,
  type Customer,
  distanceMeters,
  type Equipment,
  type FieldCaptureSettings,
  formatPadValue,
  type GpsDecision,
  type LatLng,
  type OpticalSettings,
  type PadKey,
  padValueDbm,
  pressPadKey,
} from '@fibergis/shared';

import type { MessageKey } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import type { ChoiceQuestion } from './choices';
import { cx } from './feedback';
import { PermissionHelp } from './HelpPictures';
import { BigButton, MidButton, PhotoView, PictureChoice, Say, SpeakButton } from './ui';
import type { GpsProblem } from './useGps';

export function StepTitle({ k, values }: { k: MessageKey; values?: Record<string, string | number> }) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="flex-1 text-[1.5rem] font-bold leading-snug text-slate-900">
        <Say k={k} values={values} />
      </h1>
      <SpeakButton k={k} />
    </div>
  );
}

/** A ring that fills while GPS works. Never shows coordinates or metres. */
function ProgressRing({ value, size = 48 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#cbd5e1" strokeWidth="6" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#1e40af"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Small GPS line under the camera: progress, or a green tick once the place is found. */
export function GpsBadge({ decision, frozen }: { decision: GpsDecision; frozen?: boolean }) {
  const { t } = useT();
  if (frozen || decision.state === 'good') {
    return (
      <div className="flex items-center gap-2 text-[1.125rem] font-bold text-emerald-900" data-testid="gps-badge" data-state="good">
        <CheckCircle2 className="h-8 w-8 text-emerald-800" aria-hidden /> {t('gps.good')}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[1rem] font-semibold text-slate-900" data-testid="gps-badge" data-state={decision.state}>
      <ProgressRing value={decision.progress} size={36} /> {t(decision.state === 'no_fix' ? 'gps.openSky' : 'gps.searching')}
    </div>
  );
}

/** Waiting for GPS. Moves on by itself at the green tick; after waiting, offers "office will place it". */
export function GpsStep({ decision, problem, onOfficePlace }: { decision: GpsDecision; problem: GpsProblem; onOfficePlace: () => void }) {
  const { t } = useT();
  const stuck = decision.state === 'no_fix';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto p-4 text-center">
        <ProgressRing value={stuck ? 1 : decision.progress} size={120} />
        <StepTitle k={stuck ? 'gps.openSky' : 'gps.searching'} />
        {problem === 'denied' && (
          <div className="w-full text-left">
            <p className="mb-3 text-[1.25rem] font-bold text-red-800">{t('gps.blocked')}</p>
            <PermissionHelp show={['denied']} />
          </div>
        )}
        {problem === 'unavailable' && <p className="text-[1.25rem] font-bold text-red-800">{t('gps.unavailable')}</p>}
      </div>
      {stuck && (
        <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
          <BigButton tone="plain" icon={MapPinOff} onClick={onOfficePlace} testId="office-place">
            {t('gps.officePlace')}
          </BigButton>
        </div>
      )}
    </div>
  );
}

const assetPhoto = (e: Equipment) => ({ photoId: e.photoIds?.[0], url: e.images?.[0]?.url });

/** "Same one?" with the photo of each nearby candidate. */
export function SameStep({
  kind,
  candidates,
  onSame,
  onNew,
}: {
  kind: 'pole' | 'box' | 'drop';
  candidates: Equipment[];
  onSame: (e: Equipment) => void;
  onNew: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <StepTitle k="same.title" values={{ kind }} />
        {candidates.map((e) => {
          const photo = assetPhoto(e);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSame(e)}
              data-testid="same-candidate"
              className="flex min-h-[6rem] w-full items-center gap-3 rounded-2xl border-2 border-slate-900 bg-white p-2 text-left text-[1.125rem] font-bold text-slate-900"
            >
              {photo.photoId || photo.url ? (
                <PhotoView photoId={photo.photoId} url={photo.url} className="h-20 w-20 shrink-0 rounded-xl" />
              ) : (
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-center text-[0.875rem] text-slate-700">
                  {t('same.noPhoto')}
                </span>
              )}
              <span className="flex-1">{t('same.yes', { name: e.name })}</span>
              <Check className="h-8 w-8 shrink-0" aria-hidden />
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
        <BigButton tone="primary" onClick={onNew} testId="same-new">
          {t('same.new')}
        </BigButton>
      </div>
    </div>
  );
}

/** One picture question. Tapping an answer moves on. */
export function ChoiceStep<V extends string>({ question, value, onPick }: { question: ChoiceQuestion<V>; value?: V; onPick: (v: V) => void }) {
  const { t } = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <StepTitle k={question.question} />
      <div className="grid grid-cols-2 gap-3">
        {question.options.map((option) => (
          <PictureChoice
            key={option.value}
            testId={`choice-${option.value}`}
            picture={<img src={option.picture} alt="" className="h-20 w-20" />}
            label={t(option.label)}
            speak={option.label}
            selected={value === option.value}
            onPick={() => onPick(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

const matches = (c: Customer, q: string) => {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return [c.name, c.mobile, c.id, c.address, c.area].some((v) => v?.toLowerCase().includes(query));
};

/** Pick the customer: nearest first when GPS is known, or search by name or number. */
export function CustomerStep({
  customers,
  here,
  allowNotListed,
  onPick,
}: {
  customers: Customer[];
  here?: LatLng;
  allowNotListed: boolean;
  onPick: (c: Customer | null) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const withDistance = customers
      .filter((c) => matches(c, query))
      .map((c) => ({ c, d: here && Number.isFinite(c.lat) && (c.lat !== 0 || c.lng !== 0) ? distanceMeters(here, [c.lat, c.lng]) : undefined }));
    withDistance.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || a.c.name.localeCompare(b.c.name));
    return withDistance.slice(0, 8);
  }, [customers, query, here]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <StepTitle k="customer.title" />
        <label className="flex min-h-[3.5rem] items-center gap-2 rounded-2xl border-2 border-slate-900 bg-white px-3">
          <Search className="h-6 w-6 shrink-0 text-slate-900" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customer.search')}
            aria-label={t('customer.search')}
            className="min-w-0 flex-1 bg-transparent py-3 text-[1.125rem] text-slate-900 outline-none placeholder:text-slate-600"
          />
        </label>
        {list.length === 0 && <p className="text-[1.125rem] font-semibold text-slate-900">{t('customer.none')}</p>}
        {list.map(({ c, d }) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            data-testid="customer-option"
            className="flex min-h-[4.5rem] w-full flex-col justify-center rounded-2xl border-2 border-slate-900 bg-white px-3 py-2 text-left text-slate-900"
          >
            <span className="text-[1.125rem] font-bold">{c.name}</span>
            <span className="text-[1rem] text-slate-700">
              {[c.area || c.address, d !== undefined ? t('customer.distance', { meters: Math.round(d) }) : null].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
      {allowNotListed && (
        <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
          <MidButton icon={X} onClick={() => onPick(null)} testId="customer-not-listed">
            {t('customer.notListed')}
          </MidButton>
        </div>
      )}
    </div>
  );
}

const PAD_KEYS: PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

/**
 * The light meter pad. Only digits are typed; the minus sign, dot and unit are supplied, and the
 * value is read back large. The range check warns but never blocks: the meter photo is the proof.
 */
export function PadStep({
  digits,
  onDigits,
  photoId,
  customerName,
  field,
  optical,
  onSave,
  onFix,
  saving,
}: {
  digits: string;
  onDigits: (digits: string) => void;
  photoId?: string;
  customerName: string;
  field: FieldCaptureSettings['rx'];
  optical: OpticalSettings;
  onSave: () => void;
  onFix: () => void;
  saving: boolean;
}) {
  const { t } = useT();
  const value = padValueDbm(digits, field.decimals);
  const check = value === undefined ? null : checkRxEntry(value, field, optical);
  const warn = check && check !== 'ok';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <div className="flex items-center gap-3">
          {photoId && <PhotoView photoId={photoId} className="h-16 w-16 shrink-0 rounded-xl border-2 border-slate-900" />}
          <div className="min-w-0 flex-1">
            <StepTitle k="pad.title" />
            <p className="text-[1rem] font-semibold text-slate-700">
              <Say k="pad.hint" /> · {t('summary.customer', { name: customerName })}
            </p>
          </div>
        </div>
        <div
          className="flex items-baseline justify-center gap-2 rounded-2xl border-2 border-slate-900 bg-white py-2 font-bold text-slate-900"
          aria-live="polite"
          data-testid="pad-readback"
        >
          <span className="tabular text-[3rem] leading-none">{formatPadValue(digits, field.decimals)}</span>
          <span className="text-[1.5rem]">dBm</span>
        </div>
        {check && (
          <p
            data-testid="pad-check"
            data-check={check}
            className={cx(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-[1.125rem] font-bold',
              warn ? 'bg-amber-200 text-slate-900' : 'bg-emerald-100 text-emerald-950',
            )}
          >
            {warn ? <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden /> : <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden />}
            {t(`pad.${check}` as MessageKey)}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {PAD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`pad-${key}`}
              onClick={() => onDigits(pressPadKey(digits, key))}
              className={cx(
                'flex min-h-[4rem] items-center justify-center rounded-2xl border-2 border-slate-900 bg-white font-bold text-slate-900',
                /\d/.test(key) ? 'tabular text-[1.75rem]' : 'text-[1rem]',
              )}
            >
              {key === 'back' ? (
                <span className="flex flex-col items-center">
                  <Delete className="h-6 w-6" aria-hidden />
                  {t('pad.delete')}
                </span>
              ) : key === 'clear' ? (
                t('pad.clear')
              ) : (
                key
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-t-2 border-slate-900 bg-white p-3">
        <div className="w-1/3">
          <MidButton icon={Wrench} onClick={onFix} testId="fix">
            {t('summary.fix')}
          </MidButton>
        </div>
        <div className="flex-1">
          <BigButton tone="go" icon={Save} disabled={value === undefined || saving} onClick={onSave} testId="save">
            {value === undefined ? t('pad.empty') : t('summary.save')}
          </BigButton>
        </div>
      </div>
    </div>
  );
}
