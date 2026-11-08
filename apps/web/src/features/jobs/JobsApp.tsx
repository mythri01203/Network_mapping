import '../capture/capture.css';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Circle,
  Delete,
  Gauge,
  Navigation,
  NotebookPen,
  Package,
  Pause,
  Play,
  Undo2,
  User,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  applyJobEvent,
  isJobForField,
  type JobEventInput,
  newJobPartId,
  padValueDbm,
  resolveFieldSettings,
  type WorkOrder,
} from '@fibergis/shared';

import { type MessageKey, MESSAGES } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { currentAccount, useAuthStore } from '../../stores/authStore';
import { useBikerStore } from '../../stores/bikerStore';
import { getNetworkData, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { preferenceKey, preferenceStorage } from '../../stores/persistStorage';
import { CameraStep, type GuideShape } from '../capture/CameraStep';
import { captureService } from '../capture/captureRuntime';
import type { OutboxEntry } from '../capture/captureStorage';
import { TILE_PICTURES } from '../capture/choices';
import { celebrateSave, cx } from '../capture/feedback';
import { CustomerStep, PadStep, StepTitle } from '../capture/steps';
import { BigButton, MidButton, PhotoView, PictureChoice, Spinner, TopBar } from '../capture/ui';

/**
 * The technician's jobs (Phase 8), built to the easy-field rules: big targets, a picture with
 * each word, one question per screen, Undo after every save, and the same "Saved on phone /
 * Sending / Sent to office" chip as field capture. Every action is one job event saved first to
 * the phone (IndexedDB) and then into the work order; photos go through the capture upload queue.
 * The phone changes only the work order; the office moves and closes the fault.
 */

interface JobsMeState {
  name: string | null;
  setName: (name: string | null) => void;
}

/** Who is using this phone, remembered per device. There is no login yet: this is a choice, not proof. */
const useJobsMe = create<JobsMeState>()(
  persist((set) => ({ name: null, setName: (name) => set({ name }) }), { name: preferenceKey('jobs_me'), storage: preferenceStorage }),
);

type PhotoPurpose = 'before' | 'after' | 'service' | 'meter';

type Screen =
  | { name: 'who' }
  | { name: 'list' }
  | { name: 'job'; jobId: string }
  | { name: 'camera'; jobId: string; purpose: PhotoPurpose; customerId?: string }
  | { name: 'pad'; jobId: string; photoId: string; eventId: string; customerId?: string; digits: string }
  | { name: 'checkHow'; jobId: string }
  | { name: 'checkWhere'; jobId: string }
  | { name: 'material'; jobId: string }
  | { name: 'qty'; jobId: string; item: MaterialKey; digits: string }
  | { name: 'note'; jobId: string; hold?: boolean };

const CAMERA: Record<PhotoPurpose, { instruction: MessageKey; guide: GuideShape }> = {
  before: { instruction: 'jobs.cameraBefore', guide: 'none' },
  after: { instruction: 'jobs.cameraAfter', guide: 'none' },
  service: { instruction: 'jobs.cameraService', guide: 'square' },
  meter: { instruction: 'camera.meter', guide: 'wide' },
};

type MaterialKey = 'drop' | 'connector' | 'sleeve' | 'patch' | 'splitter';
const MATERIALS: { key: MaterialKey; label: MessageKey; unit: 'm' | 'pcs'; picture: string }[] = [
  { key: 'drop', label: 'jobs.mat.drop', unit: 'm', picture: TILE_PICTURES.drop },
  { key: 'connector', label: 'jobs.mat.connector', unit: 'pcs', picture: TILE_PICTURES.box },
  { key: 'sleeve', label: 'jobs.mat.sleeve', unit: 'pcs', picture: TILE_PICTURES.pole },
  { key: 'patch', label: 'jobs.mat.patch', unit: 'pcs', picture: TILE_PICTURES.light },
  { key: 'splitter', label: 'jobs.mat.splitter', unit: 'pcs', picture: TILE_PICTURES.box },
];

function statusKey(w: WorkOrder): MessageKey {
  if (w.status === 'Verified' || w.status === 'Closed' || w.status === 'Cancelled') return 'jobs.statusDone';
  if (w.status === 'Completed') return w.verification ? 'jobs.statusDone' : 'jobs.statusCheck';
  if (w.status === 'On Hold') return 'jobs.statusHold';
  if (w.status === 'In Progress') return 'jobs.statusStarted';
  return 'jobs.statusNew';
}

/** The phone's record of one job event: its id is the event's, so a repeated save finds it. */
const jobEntry = (order: WorkOrder, event: JobEventInput, photoIds: string[], text: string): OutboxEntry => ({
  id: event.id,
  kind: 'job',
  collection: 'workOrders',
  recordId: order.id,
  label: `${order.title}: ${text}`.slice(0, 200),
  jobEvent: event,
  photoIds,
  status: 'saved',
  savedAt: Date.now(),
});

const hasPhoto = (w: WorkOrder, kind: 'before' | 'after') => (w.photoRefs ?? []).some((p) => p.kind === kind);

/** Digits only, no sign or dot: a whole number for how many were used. */
function CountPad({ digits, onDigits }: { digits: string; onDigits: (d: string) => void }) {
  const { t } = useT();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          data-testid={`count-${k}`}
          onClick={() => onDigits(k === 'clear' ? '' : k === 'back' ? digits.slice(0, -1) : (digits + k).replace(/^0+(?=\d)/, '').slice(0, 5))}
          className={cx('flex min-h-[4rem] items-center justify-center rounded-2xl border-2 border-slate-900 bg-white font-bold text-slate-900', /\d/.test(k) ? 'tabular text-[1.75rem]' : 'text-[1rem]')}
        >
          {k === 'back' ? (
            <span className="flex flex-col items-center">
              <Delete className="h-6 w-6" aria-hidden />
              {t('pad.delete')}
            </span>
          ) : k === 'clear' ? (
            t('pad.clear')
          ) : (
            k
          )}
        </button>
      ))}
    </div>
  );
}

export function JobsApp() {
  const navigate = useNavigate();
  const { t, lang } = useT();
  // Phase 9: with login on, the technician is the person logged in. The name picker stays for setup mode.
  const account = useAuthStore((s) => currentAccount(s));
  const picked = useJobsMe((s) => s.name);
  const me = account ? account.displayName : picked;
  const setMe = useJobsMe((s) => s.setName);
  const workOrders = useNetworkStore((s) => s.workOrders);
  const customers = useNetworkStore((s) => s.customers);
  const equipment = useNetworkStore((s) => s.equipment);
  const faults = useNetworkStore((s) => s.faults);
  const settingsRecords = useNetworkStore((s) => s.settings);
  const optical = useNetworkStore(selectOpticalSettings);
  const field = useMemo(() => resolveFieldSettings(settingsRecords), [settingsRecords]);
  const [screen, setScreen] = useState<Screen>(() => (me ? { name: 'list' } : { name: 'who' }));
  const [lastSaved, setLastSaved] = useState<{ jobId: string; eventId: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    const root = document.documentElement;
    const previous = { fontSize: root.style.fontSize, title: document.title };
    root.style.fontSize = '100%';
    return () => {
      root.style.fontSize = previous.fontSize;
      document.title = previous.title;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t('jobs.tile')} · FiberGIS`;
  }, [lang, t]);

  const names = useMemo(() => [...new Set(workOrders.map((w) => w.technicianName).filter((n) => n && n !== 'Unassigned'))].sort(), [workOrders]);
  const mine = workOrders.filter((w) => w.technicianName === me);
  const open = mine.filter(isJobForField);
  const done = mine.filter((w) => !isJobForField(w)).slice(0, 10);
  const jobOf = (id: string) => workOrders.find((w) => w.id === id);

  /** Saves one job event: phone storage first, then the work order. A repeated save adds nothing. */
  async function save(order: WorkOrder, event: JobEventInput, photoIds: string[], text: string, next: Screen): Promise<boolean> {
    if (saving) return false;
    // Same rules as the office and the server, checked before anything is stored.
    const check = applyJobEvent(getNetworkData(), order.id, event);
    if (!check.ok) {
      setProblem(check.error.message);
      return false;
    }
    setSaving(true);
    setProblem(null);
    const entry = jobEntry(order, event, photoIds, text);
    try {
      await captureService.save(entry);
      celebrateSave();
      setLastSaved({ jobId: order.id, eventId: event.id, text });
      setScreen(next);
      return true;
    } catch {
      setProblem(t('jobs.notSaved'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const base = <K extends JobEventInput['kind']>(kind: K) => ({ id: newJobPartId('EVT'), at: new Date().toISOString(), by: me ?? 'Unknown', kind });

  const placeOf = (w: WorkOrder) => {
    const eq = w.equipmentId ? equipment.find((e) => e.id === w.equipmentId) : undefined;
    if (eq) return { label: eq.name, lat: eq.lat, lng: eq.lng, id: eq.id };
    const c = w.customerId ? customers.find((x) => x.id === w.customerId) : undefined;
    if (c && (c.lat !== 0 || c.lng !== 0)) return { label: c.name, lat: c.lat, lng: c.lng, id: c.id };
    return null;
  };

  /** Houses where a check reading can be taken: the job's customer, else the fault's affected ones. */
  const checkCustomers = (w: WorkOrder) => {
    if (w.customerId) return customers.filter((c) => c.id === w.customerId);
    const fault = w.faultId ? faults.find((f) => f.id === w.faultId) : undefined;
    const ids = new Set(fault?.affectedCustomerIds ?? []);
    return customers.filter((c) => ids.has(c.id));
  };

  function renderJob(w: WorkOrder) {
    const place = placeOf(w);
    const active = w.status === 'In Progress';
    const startable = ['Pending', 'Assigned', 'Accepted', 'On Hold'].includes(w.status);
    const needsCheck = w.status === 'Completed' && !w.verification;
    const finished = !isJobForField(w);
    const photos = w.photoRefs ?? [];
    const main = (() => {
      if (startable) {
        return (
          <BigButton tone="go" icon={Play} testId="job-start" disabled={saving} onClick={() => void save(w, base('start'), [], w.status === 'On Hold' ? t('jobs.resume') : t('jobs.start'), hasPhoto(w, 'before') ? { name: 'job', jobId: w.id } : { name: 'camera', jobId: w.id, purpose: 'before' })}>
            {w.status === 'On Hold' ? t('jobs.resume') : t('jobs.start')}
          </BigButton>
        );
      }
      if (active && !hasPhoto(w, 'before')) return <BigButton icon={Camera} testId="job-photo-before" onClick={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'before' })}>{t('jobs.photoBefore')}</BigButton>;
      if (active && !hasPhoto(w, 'after')) return <BigButton icon={Camera} testId="job-photo-after" onClick={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'after' })}>{t('jobs.photoAfter')}</BigButton>;
      if (active) return <BigButton tone="go" icon={Wrench} testId="job-repair-done" disabled={saving} onClick={() => void save(w, base('repair_done'), [], t('jobs.repairDone'), { name: 'checkHow', jobId: w.id })}>{t('jobs.repairDone')}</BigButton>;
      if (needsCheck) return <BigButton tone="go" icon={Gauge} testId="job-check" onClick={() => setScreen({ name: 'checkHow', jobId: w.id })}>{t('jobs.checkTitle')}</BigButton>;
      return null;
    })();
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-testid="job-screen">
          {w.isTest && (
            <p className="rounded-xl border-2 border-violet-900 bg-violet-100 px-3 py-2 text-[1.125rem] font-bold text-violet-950" data-testid="job-test">
              {t('jobs.test')}
            </p>
          )}
          <h1 className="text-[1.5rem] font-bold leading-snug text-slate-900" data-testid="job-title">
            {w.title}
          </h1>
          <p className="flex items-center gap-2 text-[1.125rem] font-semibold text-slate-900" data-testid="job-status" data-status={w.status}>
            {finished ? <CheckCircle2 className="h-7 w-7 text-emerald-800" aria-hidden /> : <Circle className="h-7 w-7 text-blue-800" aria-hidden />}
            {t(statusKey(w))}
          </p>
          {place && (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[1.125rem] text-slate-900">{t('jobs.where', { place: place.label })}</p>
              <div className="w-1/2">
                <MidButton
                  icon={Navigation}
                  testId="job-navigate"
                  onClick={() => {
                    // Bike Mode: real GPS only, no simulated position.
                    const biker = useBikerStore.getState();
                    biker.navigateTo({ id: place.id, name: place.label, lat: place.lat, lng: place.lng });
                    biker.setBikerMode(true);
                    biker.setActiveBikerTab('navigation');
                    navigate('/');
                  }}
                >
                  {t('jobs.navigate')}
                </MidButton>
              </div>
            </div>
          )}
          {lastSaved?.jobId === w.id && (
            <div className="flex items-center gap-2 rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-2" data-testid="job-saved">
              <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-800" aria-hidden />
              <span className="flex-1 text-[1.125rem] font-bold text-emerald-950">
                {t('jobs.saved')}: {lastSaved.text}
              </span>
              <button
                type="button"
                data-testid="job-undo"
                onClick={() => {
                  void captureService.undo(lastSaved.eventId).then(() => setLastSaved(null));
                }}
                className="flex min-h-[3.5rem] items-center gap-1 rounded-xl border-2 border-slate-900 bg-white px-3 text-[1rem] font-bold text-slate-900"
              >
                <Undo2 className="h-6 w-6" aria-hidden /> {t('saved.undo')}
              </button>
            </div>
          )}
          {problem && (
            <p className="flex items-center gap-2 rounded-xl bg-red-800 p-3 text-[1.125rem] font-bold text-white" data-testid="job-problem">
              <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden /> {problem}
            </p>
          )}
          {finished && <p className="rounded-xl bg-emerald-100 p-3 text-[1.125rem] font-semibold text-emerald-950">{w.verification ? t('jobs.checkSaved') : t('jobs.closed')}</p>}
          {photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {photos.map((p) => (
                <figure key={p.photoId} className="shrink-0 text-center text-[0.95rem] font-semibold text-slate-900">
                  <PhotoView photoId={p.photoId} className="h-24 w-24 rounded-xl border-2 border-slate-900" />
                  <figcaption>{p.kind === 'before' ? t('jobs.photoBefore') : p.kind === 'after' ? t('jobs.photoAfter') : t('jobs.checkPhoto')}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {active && (w.steps ?? []).length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[1.125rem] font-bold text-slate-900">{t('jobs.steps')}</h2>
              {w.steps!.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid="job-step"
                  disabled={!!s.doneAt || saving}
                  onClick={() => void save(w, { ...base('step'), stepId: s.id }, [], s.label, { name: 'job', jobId: w.id })}
                  className={cx(
                    'flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border-2 px-3 text-left text-[1.125rem] font-semibold',
                    s.doneAt ? 'border-emerald-800 bg-emerald-50 text-emerald-950' : 'border-slate-900 bg-white text-slate-900',
                  )}
                >
                  {s.doneAt ? <CheckCircle2 className="h-8 w-8 shrink-0" aria-hidden /> : <Circle className="h-8 w-8 shrink-0" aria-hidden />}
                  <span>{s.label}</span>
                </button>
              ))}
            </section>
          )}
          {active && (
            <div className="grid grid-cols-2 gap-2">
              <MidButton icon={Camera} testId="job-more-before" onClick={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'before' })}>
                {t('jobs.photoBefore')}
              </MidButton>
              <MidButton icon={Camera} testId="job-more-after" onClick={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'after' })}>
                {t('jobs.photoAfter')}
              </MidButton>
              <MidButton icon={Package} testId="job-material" onClick={() => setScreen({ name: 'material', jobId: w.id })}>
                {t('jobs.material')}
              </MidButton>
              <MidButton icon={NotebookPen} testId="job-note" onClick={() => { setNoteText(''); setScreen({ name: 'note', jobId: w.id }); }}>
                {t('jobs.note')}
              </MidButton>
              <MidButton icon={Pause} testId="job-hold" onClick={() => { setNoteText(''); setScreen({ name: 'note', jobId: w.id, hold: true }); }}>
                {t('jobs.hold')}
              </MidButton>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
          {main}
          <MidButton onClick={() => { setProblem(null); setScreen({ name: 'list' }); }} testId="job-back-list">
            {t('jobs.myJobs')}
          </MidButton>
        </div>
      </div>
    );
  }

  const body = (() => {
    switch (screen.name) {
      case 'who':
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="jobs-who">
            <StepTitle k="jobs.who" />
            {names.map((n) => (
              <button key={n} type="button" data-testid="jobs-name" onClick={() => { setMe(n); setScreen({ name: 'list' }); }} className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 border-slate-900 bg-white px-4 text-[1.25rem] font-bold text-slate-900">
                <User className="h-8 w-8 shrink-0" aria-hidden /> {n}
              </button>
            ))}
            <div className="rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
              <p className="text-[1.125rem] font-bold text-slate-900">{t('jobs.notListed')}</p>
              <p className="text-[1.0625rem] text-slate-900">{t('jobs.notListedHelp')}</p>
            </div>
          </div>
        );
      case 'list':
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-testid="jobs-list">
            <div className="flex items-center gap-2">
              <h1 className="flex-1 text-[1.5rem] font-bold text-slate-900">{t('jobs.tile')}</h1>
              <button
                type="button"
                data-testid="jobs-not-me"
                onClick={() => {
                  if (account) {
                    void useAuthStore.getState().logout();
                    return;
                  }
                  setMe(null);
                  setScreen({ name: 'who' });
                }}
                className="flex min-h-[3rem] items-center gap-1 rounded-xl border-2 border-slate-900 bg-white px-2 text-[1rem] font-semibold"
              >
                <User className="h-5 w-5" aria-hidden /> {me} · {t('jobs.notMe')}
              </button>
            </div>
            {open.length === 0 && <p className="text-[1.125rem] font-semibold text-slate-900">{t('jobs.none')}</p>}
            {open.map((w) => (
              <button key={w.id} type="button" data-testid="job-card" onClick={() => { setProblem(null); setScreen({ name: 'job', jobId: w.id }); }} className="flex min-h-[5.5rem] w-full items-center gap-3 rounded-2xl border-2 border-slate-900 bg-white p-3 text-left text-slate-900">
                <img src={TILE_PICTURES.box} alt="" className="h-14 w-14 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  {w.isTest && <span className="text-[1rem] font-extrabold text-violet-900">{t('jobs.test')}</span>}
                  <span className="text-[1.125rem] font-bold">{w.title}</span>
                  <span className="text-[1rem] text-slate-700">{t(statusKey(w))}</span>
                </span>
                <ChevronRight className="h-8 w-8 shrink-0" aria-hidden />
              </button>
            ))}
            {done.length > 0 && (
              <>
                <h2 className="text-[1.125rem] font-bold text-slate-900">{t('jobs.finished')}</h2>
                {done.map((w) => (
                  <button key={w.id} type="button" onClick={() => setScreen({ name: 'job', jobId: w.id })} className="flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border-2 border-slate-300 bg-slate-50 p-2 text-left text-slate-900">
                    <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-800" aria-hidden />
                    <span className="text-[1.0625rem] font-semibold">{w.title}</span>
                  </button>
                ))}
              </>
            )}
            <MidButton onClick={() => navigate('/capture')}>{t('home.title')}</MidButton>
          </div>
        );
      case 'job': {
        const w = jobOf(screen.jobId);
        return w ? renderJob(w) : <Spinner label="…" />;
      }
      case 'camera': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        const { purpose } = screen;
        return (
          <CameraStep
            key={`${w.id}-${purpose}`}
            instruction={CAMERA[purpose].instruction}
            guide={CAMERA[purpose].guide}
            onPhoto={async (blob) => {
              const eventId = newJobPartId('EVT');
              const photoId = await captureService.addEventPhoto(eventId, blob);
              const now = new Date().toISOString();
              if (purpose === 'meter') {
                setScreen({ name: 'pad', jobId: w.id, photoId, eventId, customerId: screen.customerId, digits: '' });
                return;
              }
              const event: JobEventInput =
                purpose === 'service'
                  ? { id: eventId, at: now, by: me ?? 'Unknown', kind: 'verify', verification: { method: 'photo', photoId, note: 'Photo of the working device from the field' } }
                  : { id: eventId, at: now, by: me ?? 'Unknown', kind: 'photo', photoId, photoKind: purpose };
              const ok = await save(w, event, [photoId], purpose === 'before' ? t('jobs.photoBefore') : purpose === 'after' ? t('jobs.photoAfter') : t('jobs.checkPhoto'), { name: 'job', jobId: w.id });
              if (!ok) await captureService.dropPhoto(photoId);
            }}
          />
        );
      }
      case 'checkHow': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="job-check-how">
            <StepTitle k="jobs.checkTitle" />
            <div className="grid grid-cols-2 gap-3">
              <PictureChoice testId="check-reading" picture={<img src={TILE_PICTURES.light} alt="" className="h-20 w-20" />} label={t('jobs.checkReading')} onPick={() => setScreen(checkCustomers(w).length > 1 ? { name: 'checkWhere', jobId: w.id } : { name: 'camera', jobId: w.id, purpose: 'meter', customerId: checkCustomers(w)[0]?.id })} />
              <PictureChoice testId="check-photo" picture={<img src={TILE_PICTURES.drop} alt="" className="h-20 w-20" />} label={t('jobs.checkPhoto')} onPick={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'service' })} />
            </div>
            <MidButton onClick={() => setScreen({ name: 'job', jobId: w.id })}>{t('jobs.backToJob')}</MidButton>
          </div>
        );
      }
      case 'checkWhere': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        return <CustomerStep customers={checkCustomers(w)} allowNotListed={false} onPick={(c) => setScreen({ name: 'camera', jobId: w.id, purpose: 'meter', customerId: c?.id })} />;
      }
      case 'pad': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        const pad = screen;
        const customer = pad.customerId ? customers.find((c) => c.id === pad.customerId) : undefined;
        return (
          <PadStep
            digits={pad.digits}
            onDigits={(digits) => setScreen({ ...pad, digits })}
            photoId={pad.photoId}
            customerName={customer?.name ?? w.title}
            field={field.rx}
            optical={optical}
            saving={saving}
            onFix={() => setScreen({ name: 'camera', jobId: w.id, purpose: 'meter', customerId: pad.customerId })}
            onSave={() => {
              const value = padValueDbm(pad.digits, field.rx.decimals);
              if (value === undefined) return;
              const event: JobEventInput = {
                id: pad.eventId,
                at: new Date().toISOString(),
                by: me ?? 'Unknown',
                kind: 'verify',
                verification: { method: 'field_reading', readingDbm: value, readingOrigin: 'field_measured', photoId: pad.photoId, ...(pad.customerId ? { customerId: pad.customerId } : {}) },
              };
              void save(w, event, [pad.photoId], `${t('jobs.checkReading')} ${value} dBm`, { name: 'job', jobId: w.id });
            }}
          />
        );
      }
      case 'material': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="job-material-pick">
            <StepTitle k="jobs.materialWhat" />
            <div className="grid grid-cols-2 gap-3">
              {MATERIALS.map((m) => (
                <PictureChoice key={m.key} testId={`material-${m.key}`} picture={<img src={m.picture} alt="" className="h-20 w-20" />} label={t(m.label)} onPick={() => setScreen({ name: 'qty', jobId: w.id, item: m.key, digits: '' })} />
              ))}
            </div>
            <MidButton onClick={() => setScreen({ name: 'job', jobId: w.id })}>{t('jobs.backToJob')}</MidButton>
          </div>
        );
      }
      case 'qty': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        const q = screen;
        const material = MATERIALS.find((m) => m.key === q.item)!;
        const unit = t(material.unit === 'm' ? 'jobs.unit.m' : 'jobs.unit.pcs');
        const count = Number(q.digits);
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
              <StepTitle k="jobs.materialHow" values={{ unit }} />
              <div className="flex items-baseline justify-center gap-2 rounded-2xl border-2 border-slate-900 bg-white py-2 font-bold text-slate-900" data-testid="count-readback">
                <span className="tabular text-[3rem] leading-none">{q.digits || '0'}</span>
                <span className="text-[1.5rem]">{unit}</span>
              </div>
              <CountPad digits={q.digits} onDigits={(digits) => setScreen({ ...q, digits })} />
            </div>
            <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
              <BigButton
                tone="go"
                testId="count-save"
                disabled={!(count > 0) || saving}
                // Stored in English, the canonical name, so the office reads the same word from every phone.
                onClick={() => void save(w, { ...base('material'), item: MESSAGES[material.label].en, quantity: count, unit: material.unit === 'm' ? 'm' : 'pieces' }, [], `${count} ${unit} ${t(material.label)}`, { name: 'job', jobId: w.id })}
              >
                {t('summary.save')}
              </BigButton>
            </div>
          </div>
        );
      }
      case 'note': {
        const w = jobOf(screen.jobId);
        if (!w) return null;
        const hold = !!screen.hold;
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <StepTitle k={hold ? 'jobs.hold' : 'jobs.note'} />
              <p className="text-[1.0625rem] text-slate-900">{t('jobs.noteHint')}</p>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} data-testid="job-note-text" aria-label={t('jobs.note')} className="w-full rounded-2xl border-2 border-slate-900 bg-white p-3 text-[1.125rem] text-slate-900" />
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
              <BigButton
                tone={hold ? 'plain' : 'go'}
                testId="job-note-save"
                disabled={saving || (!hold && !noteText.trim())}
                onClick={() =>
                  void save(w, hold ? { ...base('hold'), text: noteText } : { ...base('note'), text: noteText }, [], hold ? t('jobs.hold') : t('jobs.note'), hold ? { name: 'list' } : { name: 'job', jobId: w.id })
                }
              >
                {hold ? t('jobs.hold') : t('summary.save')}
              </BigButton>
              <MidButton onClick={() => setScreen({ name: 'job', jobId: w.id })}>{t('jobs.backToJob')}</MidButton>
            </div>
          </div>
        );
      }
    }
  })();

  const backTo = (): Screen => (screen.name === 'list' || screen.name === 'who' ? screen : 'jobId' in screen && screen.name !== 'job' ? { name: 'job', jobId: screen.jobId } : { name: 'list' });

  return (
    <div lang={lang} className="field-capture fixed inset-0 z-[1500] flex flex-col bg-slate-50 text-slate-900" data-testid="jobs-root">
      <TopBar onHome={() => { setProblem(null); setScreen(backTo()); }} showHome={screen.name !== 'list' && screen.name !== 'who'} />
      <main className="flex min-h-0 flex-1 flex-col">{body}</main>
    </div>
  );
}
