import './capture.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, HelpCircle, Languages, Map as MapIcon, Phone, Save, Tag, Trash2, Undo2, Users, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router';

import {
  assetGroupOf,
  buildCapturedEquipment,
  buildHazardFault,
  type CaptureKind,
  type CaptureLocation,
  captureLocation,
  type Equipment,
  findByTag,
  findNearbySameType,
  type GpsDecision,
  type GpsSample,
  type LatLng,
  networkAnchor,
  nextDisplayName,
  normalizeTag,
  padValueDbm,
  resolveFieldSettings,
  rxFieldsOf,
} from '@fibergis/shared';

import { useAudioManifest } from '../../i18n/audio';
import { type Language, translate } from '../../i18n/format';
import { type MessageKey, MESSAGES } from '../../i18n/messages';
import { LANGUAGE_NAMES, useFieldLanguage, useT } from '../../i18n/useT';
import { requestPersistentStorage } from '../../lib/idb';
import { currentAccount, useAuthStore } from '../../stores/authStore';
import { getNetworkData, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { CameraStep, type GuideShape, TagStep } from './CameraStep';
import { captureService } from './captureRuntime';
import { stepsFor } from './captureService';
import type { CaptureDraft, OutboxEntry } from './captureStorage';
import { BOX_QUESTION, MATERIAL_QUESTION, OWNER_QUESTION, TILE_PICTURES } from './choices';
import { celebrateSave, cx } from './feedback';
import { PermissionHelp } from './HelpPictures';
import { MiniMap } from './MiniMap';
import { preloadQrReader } from './qrScanner';
import { ChoiceStep, CustomerStep, GpsBadge, GpsStep, PadStep, SameStep, StepTitle } from './steps';
import { BigButton, MidButton, PhotoView, Say, SpeakButton, Spinner, TopBar } from './ui';
import { useGpsSampler } from './useGps';

type Screen =
  | { name: 'loading' }
  | { name: 'language' }
  | { name: 'help' }
  | { name: 'home'; note?: MessageKey }
  | { name: 'flow'; resumed?: boolean }
  | { name: 'fix' }
  | { name: 'saved'; entry: OutboxEntry; draft: CaptureDraft }
  | { name: 'already'; record: Equipment; draft: CaptureDraft };

const CAMERA: Record<CaptureKind, { instruction: MessageKey; guide: GuideShape }> = {
  pole: { instruction: 'camera.pole', guide: 'tall' },
  box: { instruction: 'camera.box', guide: 'square' },
  drop: { instruction: 'camera.drop', guide: 'square' },
  light: { instruction: 'camera.meter', guide: 'wide' },
  danger: { instruction: 'camera.danger', guide: 'none' },
};

const NAME_PREFIX = { pole: 'Pole', box: 'Box', drop: 'Drop' } as const;

const SAFETY_KEYS: MessageKey[] = ['safety.noClimb', 'safety.live', 'safety.rain', 'safety.rods', 'safety.report', 'safety.traffic', 'safety.riding'];

/** The safety reminder from india-rules.md. It is draft wording until a safety officer checks it. */
function SafetyReminder() {
  return (
    <section className="rounded-2xl border-2 border-red-900 bg-red-50 p-3" data-testid="safety-reminder">
      <h2 className="mb-2 flex items-center gap-2 text-[1.25rem] font-bold text-red-900">
        <AlertTriangle className="h-6 w-6" aria-hidden /> <Say k="danger.rulesTitle" />
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-6 text-[1.0625rem] text-slate-900">
        {SAFETY_KEYS.map((k) => (
          <li key={k}>
            <Say k={k} />
          </li>
        ))}
      </ul>
      <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[0.95rem] font-semibold text-slate-900" data-testid="safety-draft">
        <Say k="safety.draft" />
      </p>
    </section>
  );
}

function Tile({ picture, label, onClick, tone = 'plain', testId, wide }: { picture: string; label: MessageKey; onClick: () => void; tone?: 'plain' | 'danger'; testId: string; wide?: boolean }) {
  return (
    <div className={cx('relative', wide && 'col-span-2')}>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={cx(
          'flex min-h-[8.5rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 text-center text-[1.25rem] font-bold leading-tight',
          tone === 'danger' ? 'border-red-900 bg-red-800 text-white' : 'border-slate-900 bg-white text-slate-900',
          wide && 'flex-row min-h-[5.5rem]',
        )}
      >
        <img src={picture} alt="" className={cx('h-16 w-16 shrink-0', tone === 'danger' && 'rounded-lg bg-white p-1')} />
        <Say k={label} />
      </button>
      <span className="absolute right-1 top-1">
        <SpeakButton k={label} />
      </span>
    </div>
  );
}

export function CaptureApp() {
  const navigate = useNavigate();
  const { t, lang } = useT();
  const { chosen, helpSeen, setLang, setHelpSeen } = useFieldLanguage();
  const settingsRecords = useNetworkStore((s) => s.settings);
  const equipment = useNetworkStore((s) => s.equipment);
  const customers = useNetworkStore((s) => s.customers);
  const projectStart = useNetworkStore((s) => s.projectStartPoint);
  const optical = useNetworkStore(selectOpticalSettings);
  const role = useUiStore((s) => s.userRole);
  // Phase 9: the logged-in person's name, or the older role label while login is off.
  const account = useAuthStore((s) => currentAccount(s));
  const field = useMemo(() => resolveFieldSettings(settingsRecords), [settingsRecords]);

  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** An unfinished capture with a photo, kept when the worker tapped Home. */
  const [paused, setPaused] = useState<CaptureDraft | null>(null);

  // Capture uses the phone's own text size (rem = 16 px unless the user changed it) and its language.
  useEffect(() => {
    const root = document.documentElement;
    const previous = { fontSize: root.style.fontSize, lang: root.lang, title: document.title };
    root.style.fontSize = '100%';
    void useAudioManifest.getState().load();
    preloadQrReader();
    void requestPersistentStorage();
    return () => {
      root.style.fontSize = previous.fontSize;
      root.lang = previous.lang || 'en';
      document.title = previous.title;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t('home.title')} · FiberGIS`;
  }, [lang, t]);

  const goHome = useCallback(
    (note?: MessageKey) => {
      setDraft(null);
      setSaveFailed(false);
      setConfirmDiscard(false);
      setScreen(!chosen ? { name: 'language' } : !helpSeen ? { name: 'help' } : { name: 'home', note });
    },
    [chosen, helpSeen],
  );

  // Resume an unfinished capture after a reload or a killed tab.
  useEffect(() => {
    let cancelled = false;
    captureService
      .getDraft()
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          setDraft(saved);
          setScreen({ name: 'flow', resumed: true });
        } else goHome();
      })
      .catch(() => !cancelled && goHome());
    return () => {
      cancelled = true;
    };
    // Only on first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inFlow = screen.name === 'flow' && draft !== null;
  const gpsActive = inFlow && (draft.kind === 'light' ? draft.step === 'customer' : !draft.location);
  const gps = useGpsSampler(gpsActive, draft?.id ?? '', field.gps, (decision, samples) => onGpsUpdate(decision, samples));

  const placeholder = useCallback(
    (d: CaptureDraft): LatLng | undefined => {
      const previous = d.previousAssetId ? equipment.find((e) => e.id === d.previousAssetId) : undefined;
      if (previous) return [previous.lat, previous.lng];
      return networkAnchor({ equipment }, projectStart ?? undefined);
    },
    [equipment, projectStart],
  );

  const freezeLocation = useCallback(
    (d: CaptureDraft, force: boolean): CaptureLocation | undefined => {
      if (d.location) return d.location;
      if (!force && gps.decision.state !== 'good' && gps.decision.state !== 'rough') return undefined;
      return (
        captureLocation(gps.decision, gps.samples, placeholder(d)) ?? { lat: 0, lng: 0, method: 'not_placed', officeMustPlace: true }
      );
    },
    [gps.decision, gps.samples, placeholder],
  );

  const candidatesFor = useCallback(
    (d: CaptureDraft): Equipment[] => {
      const group = d.kind === 'pole' || d.kind === 'box' || d.kind === 'drop' ? d.kind : null;
      if (!group || !d.location || d.location.officeMustPlace) return [];
      return findNearbySameType(equipment, group, [d.location.lat, d.location.lng], d.location.accuracyMeters ?? 0, field.duplicate).map(
        (n) => n.equipment,
      );
    },
    [equipment, field.duplicate],
  );

  /** Saves the draft at its new step. Storage trouble shows on the sync chip as "Not saved on phone". */
  const update = useCallback((next: CaptureDraft) => {
    setDraft(next);
    void captureService.saveDraft(next).catch(() => undefined);
  }, []);

  /** Moves to the next step, skipping GPS once the place is known and "same one?" when nothing is near. */
  const advance = useCallback(
    (d: CaptureDraft & { returnToSummary?: boolean }) => {
      const steps = stepsFor(d.kind);
      let next: CaptureDraft = d;
      if (d.returnToSummary) {
        const { returnToSummary: _ignored, ...rest } = d;
        update({ ...rest, step: steps[steps.length - 1] });
        return;
      }
      let i = steps.indexOf(d.step) + 1;
      for (; i < steps.length - 1; i += 1) {
        const step = steps[i];
        if (step === 'gps' && next.location) continue;
        if (step === 'same') {
          if (next.sameChecked) continue;
          if (candidatesFor(next).length === 0) {
            next = { ...next, sameChecked: true };
            continue;
          }
        }
        break;
      }
      update({ ...next, step: steps[Math.min(i, steps.length - 1)] });
    },
    [candidatesFor, update],
  );

  // At the GPS step: move on by itself at the green tick (or a rough fix after the wait).
  const onGpsUpdate = (decision: GpsDecision, samples: GpsSample[]) => {
    if (screen.name !== 'flow' || !draft || draft.step !== 'gps' || draft.location) return;
    if (decision.state !== 'good' && decision.state !== 'rough') return;
    const location = captureLocation(decision, samples, placeholder(draft));
    if (location) advance({ ...draft, location });
  };

  const start = async (kind: CaptureKind, after?: Parameters<typeof captureService.startDraft>[1]) => {
    setSaveFailed(false);
    try {
      // Only one capture at a time: an unfinished one left behind is dropped with its photo.
      const old = await captureService.getDraft().catch(() => undefined);
      if (old) await captureService.discardDraft(old).catch(() => undefined);
      setPaused(null);
      const d = await captureService.startDraft(kind, after);
      setDraft(d);
      setScreen({ name: 'flow' });
    } catch {
      setScreen({ name: 'home', note: 'storage.failed' });
    }
  };

  const showAlready = async (record: Equipment, d: CaptureDraft) => {
    await captureService.discardDraft(d).catch(() => undefined);
    setDraft(null);
    setScreen({ name: 'already', record, draft: d });
  };

  const buildEntry = (d: CaptureDraft): OutboxEntry | null => {
    const data = getNetworkData();
    const now = new Date();
    const capturedBy = `${account ? account.displayName : role} (phone capture)`;
    if (!d.photoId) return null;
    const base = { id: d.id, kind: d.kind, photoIds: [d.photoId], status: 'saved' as const, savedAt: now.getTime() };
    if (d.kind === 'light') {
      const customer = data.customers.find((c) => c.id === d.customerId);
      const valueDbm = padValueDbm(d.rxDigits ?? '', field.rx.decimals);
      if (!customer || valueDbm === undefined) return null;
      return {
        ...base,
        collection: 'customers',
        recordId: customer.id,
        label: customer.name,
        reading: { customerId: customer.id, captureId: d.id, valueDbm, measuredAt: now.toISOString(), photoId: d.photoId },
        previousRx: rxFieldsOf(customer),
      };
    }
    const location = d.location ?? freezeLocation(d, true)!;
    if (d.kind === 'danger') {
      const record = buildHazardFault({ id: d.id, photoId: d.photoId, location, now, capturedBy });
      return { ...base, collection: 'faults', recordId: d.id, label: record.title, record };
    }
    const name = nextDisplayName(NAME_PREFIX[d.kind], data.equipment);
    const common = {
      id: d.id,
      name,
      photoId: d.photoId,
      location,
      now,
      capturedBy,
      tagCode: d.tagCode ?? undefined,
      previousAssetId: d.previousAssetId,
      runId: d.runId,
      order: d.order,
    };
    const record =
      d.kind === 'pole'
        ? buildCapturedEquipment({ ...common, kind: 'pole', ownerType: d.answers.ownerType ?? 'unknown', material: d.answers.material ?? 'unknown' })
        : d.kind === 'box'
          ? buildCapturedEquipment({ ...common, kind: 'box', boxKind: d.answers.boxKind ?? 'unknown' })
          : buildCapturedEquipment({ ...common, kind: 'drop', customerId: d.customerId ?? undefined });
    return { ...base, collection: 'equipment', recordId: d.id, label: name, record };
  };

  const save = async () => {
    if (!draft || saving) return;
    const entry = buildEntry(draft);
    if (!entry) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await captureService.save(entry);
      celebrateSave();
      setScreen({ name: 'saved', entry, draft });
      setDraft(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const next = (from: CaptureDraft, previous?: { id: string; name: string }) => {
    const chain = from.kind === 'pole' || from.kind === 'box' || from.kind === 'drop';
    void start(from.kind, {
      runId: from.runId,
      order: from.order + 1,
      ...(chain && previous ? { previousAssetId: previous.id, previousName: previous.name } : {}),
    });
  };

  /* -------------------------------- screens -------------------------------- */

  const body = (() => {
    switch (screen.name) {
      case 'loading':
        return <Spinner label="…" />;

      case 'language':
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <StepTitle k="lang.title" />
            {(['en', 'te', 'kn'] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                data-testid={`lang-${code}`}
                onClick={() => {
                  setLang(code);
                  setScreen(helpSeen ? { name: 'home' } : { name: 'help' });
                }}
                className={cx(
                  'flex min-h-[4.5rem] w-full flex-col items-center justify-center rounded-2xl border-2 px-4 py-2 text-[1.5rem] font-bold',
                  lang === code && chosen ? 'border-blue-900 bg-blue-800 text-white' : 'border-slate-900 bg-white text-slate-900',
                )}
              >
                <span>{LANGUAGE_NAMES[code]}</span>
                {code !== 'en' && <span className="text-[1rem] font-semibold">{translate(MESSAGES, code, 'lang.draft').text}</span>}
              </button>
            ))}
          </div>
        );

      case 'help':
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <StepTitle k="help.title" />
              {typeof window !== 'undefined' && window.isSecureContext === false && (
                <p className="rounded-xl bg-red-800 p-3 text-[1.125rem] font-bold text-white" data-testid="insecure">
                  {t('help.insecure')}
                </p>
              )}
              <PermissionHelp show={['camera', 'location', 'denied']} />
              <p className="text-[1.125rem] font-semibold text-slate-900">
                <Say k="help.undo" />
              </p>
            </div>
            <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
              <BigButton
                tone="go"
                onClick={() => {
                  setHelpSeen(true);
                  setScreen({ name: 'home' });
                }}
                testId="help-start"
              >
                {t('help.start')}
              </BigButton>
            </div>
          </div>
        );

      case 'home':
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {screen.note && (
              <p
                className={cx('rounded-xl p-3 text-[1.125rem] font-bold', screen.note === 'storage.failed' ? 'bg-red-800 text-white' : 'bg-emerald-100 text-emerald-950')}
                data-testid="home-note"
              >
                {t(screen.note)}
              </p>
            )}
            {paused && (
              <button
                type="button"
                data-testid="continue"
                onClick={() => {
                  setDraft(paused);
                  setPaused(null);
                  setScreen({ name: 'flow' });
                }}
                className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 border-blue-900 bg-blue-800 p-2 text-left text-[1.25rem] font-bold text-white"
              >
                {paused.photoId && <PhotoView photoId={paused.photoId} className="h-14 w-14 shrink-0 rounded-xl" />}
                <span>{t('home.continue')}</span>
              </button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Tile picture={TILE_PICTURES.pole} label="home.addPole" onClick={() => void start('pole')} testId="tile-pole" />
              <Tile picture={TILE_PICTURES.box} label="home.addBox" onClick={() => void start('box')} testId="tile-box" />
              <Tile picture={TILE_PICTURES.drop} label="home.addDrop" onClick={() => void start('drop')} testId="tile-drop" />
              <Tile picture={TILE_PICTURES.light} label="home.lightLevel" onClick={() => void start('light')} testId="tile-light" />
              <Tile picture={TILE_PICTURES.danger} label="home.danger" onClick={() => void start('danger')} tone="danger" testId="tile-danger" wide />
              <Tile picture={TILE_PICTURES.box} label="jobs.tile" onClick={() => navigate('/jobs')} testId="tile-jobs" wide />
            </div>
            {field.supervisorPhone && (
              <a
                href={`tel:${field.supervisorPhone.replace(/[\s-]/g, '')}`}
                data-testid="call-supervisor"
                className="flex min-h-[4rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-900 bg-emerald-800 text-[1.25rem] font-bold text-white"
              >
                <Phone className="h-7 w-7" aria-hidden /> {t('home.callSupervisor')}
              </a>
            )}
            <div className="grid grid-cols-3 gap-2">
              <MidButton icon={HelpCircle} onClick={() => setScreen({ name: 'help' })}>
                {t('home.help')}
              </MidButton>
              <MidButton icon={Languages} onClick={() => setScreen({ name: 'language' })} testId="open-language">
                {t('home.language')}
              </MidButton>
              <MidButton icon={MapIcon} onClick={() => navigate('/')}>
                {t('home.officeMap')}
              </MidButton>
            </div>
          </div>
        );

      case 'fix': {
        if (!draft) return null;
        const back = () => setScreen({ name: 'flow' });
        const redo = (step: CaptureDraft['step'], toSummary: boolean, reset: Partial<CaptureDraft> = {}) => {
          const next = { ...draft, ...reset, step, ...(toSummary ? { returnToSummary: true } : {}) } as CaptureDraft;
          update(next);
          setScreen({ name: 'flow' });
        };
        return (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <StepTitle k="fix.title" />
            <MidButton icon={Camera} onClick={() => redo('camera', true)} testId="fix-photo">
              {t('camera.retake')}
            </MidButton>
            {(draft.kind === 'pole' || draft.kind === 'box') && (
              <MidButton icon={Tag} onClick={() => redo('tag', true)}>
                {t('fix.tag')}
              </MidButton>
            )}
            {(draft.kind === 'pole' || draft.kind === 'box') && (
              <MidButton icon={Wrench} onClick={() => redo(draft.kind === 'pole' ? 'owner' : 'boxKind', false)} testId="fix-answers">
                {t('fix.answers')}
              </MidButton>
            )}
            {(draft.kind === 'drop' || draft.kind === 'light') && (
              <MidButton icon={Users} onClick={() => redo('customer', true)}>
                {t('fix.customer')}
              </MidButton>
            )}
            {confirmDiscard ? (
              <div className="flex flex-col gap-2 rounded-2xl border-2 border-red-900 bg-red-50 p-3">
                {draft.photoId && <PhotoView photoId={draft.photoId} className="h-24 w-full rounded-xl" />}
                <p className="text-[1.125rem] font-bold text-slate-900">{t('fix.discardAsk')}</p>
                <BigButton
                  tone="danger"
                  icon={Trash2}
                  onClick={() => {
                    void captureService.discardDraft(draft).finally(() => goHome());
                  }}
                  testId="discard-confirm"
                >
                  {t('fix.discard')}
                </BigButton>
                <MidButton onClick={() => setConfirmDiscard(false)}>{t('fix.keep')}</MidButton>
              </div>
            ) : (
              <MidButton icon={Trash2} onClick={() => setConfirmDiscard(true)} testId="fix-discard">
                {t('fix.discard')}
              </MidButton>
            )}
            <MidButton onClick={back}>{t('common.back')}</MidButton>
          </div>
        );
      }

      case 'saved': {
        const { entry, draft: savedDraft } = screen;
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4 text-center">
              <CheckCircle2 className="h-24 w-24 text-emerald-800" aria-hidden />
              <h1 className="text-[1.75rem] font-bold text-slate-900" data-testid="saved-title">
                <Say k="saved.title" />
              </h1>
              <p className="text-[1.25rem] font-semibold text-slate-900" data-testid="saved-label">
                {entry.label}
              </p>
              {entry.photoIds[0] && <PhotoView photoId={entry.photoIds[0]} className="h-32 w-32 rounded-2xl border-2 border-slate-900" />}
              {entry.kind === 'danger' && (
                <>
                  <p className="text-[1.25rem] font-bold text-red-900">{t('danger.saved')}</p>
                  <SafetyReminder />
                </>
              )}
              <p className="text-[1rem] font-semibold text-slate-700">{t('saved.undoHint')}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
              <div className="grid grid-cols-2 gap-2">
                <MidButton
                  icon={Undo2}
                  onClick={() => {
                    void captureService.undo(entry.id).then(() => goHome('saved.undone'));
                  }}
                  testId="undo"
                >
                  {t('saved.undo')}
                </MidButton>
                <MidButton onClick={() => goHome()} testId="finished">
                  {t('saved.finished')}
                </MidButton>
              </div>
              <BigButton tone="go" icon={Camera} onClick={() => next(savedDraft, { id: entry.recordId, name: entry.label })} testId="next">
                {t('saved.next', { kind: entry.kind })}
              </BigButton>
            </div>
          </div>
        );
      }

      case 'already': {
        const { record, draft: oldDraft } = screen;
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4 text-center">
              <PhotoView photoId={record.photoIds?.[0]} url={record.images?.[0]?.url} className="h-40 w-40 rounded-2xl border-2 border-slate-900" />
              <h1 className="text-[1.5rem] font-bold text-slate-900" data-testid="already-title">
                <Say k="already.title" />
              </h1>
              <p className="text-[1.25rem] font-semibold text-slate-900">{record.name}</p>
              <p className="text-[1.125rem] text-slate-900">{t('already.body', { name: record.name })}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
              <MidButton onClick={() => goHome()} testId="finished">{t('saved.finished')}</MidButton>
              <BigButton tone="go" icon={Camera} onClick={() => next(oldDraft, { id: record.id, name: record.name })} testId="next">
                {t('saved.next', { kind: oldDraft.kind })}
              </BigButton>
            </div>
          </div>
        );
      }

      case 'flow':
        return draft ? renderStep(draft) : null;
    }
  })();

  function renderStep(d: CaptureDraft) {
    switch (d.step) {
      case 'camera': {
        const camera = CAMERA[d.kind];
        return (
          <CameraStep
            key={`${d.id}-camera`}
            instruction={camera.instruction}
            guide={camera.guide}
            status={d.kind !== 'light' ? <GpsBadge decision={gps.decision} frozen={!!d.location && !d.location.officeMustPlace} /> : undefined}
            onPhoto={async (blob) => {
              const photoId = await captureService.addPhoto(d, blob);
              const withPhoto: CaptureDraft = { ...d, photoId };
              const location = d.kind === 'light' ? undefined : freezeLocation(withPhoto, false);
              advance(location ? { ...withPhoto, location } : withPhoto);
            }}
          />
        );
      }
      case 'gps':
        return (
          <GpsStep
            decision={gps.decision}
            problem={gps.problem}
            onOfficePlace={() => advance({ ...d, location: freezeLocation(d, true) })}
          />
        );
      case 'same':
        return (
          <SameStep
            kind={d.kind as 'pole' | 'box' | 'drop'}
            candidates={candidatesFor(d)}
            onSame={(record) => void showAlready(record, d)}
            onNew={() => advance({ ...d, sameChecked: true })}
          />
        );
      case 'tag':
        return (
          <TagStep
            key={`${d.id}-tag`}
            onTag={(code) => {
              const tagCode = normalizeTag(code);
              const known = findByTag(equipment, tagCode);
              if (known && assetGroupOf(known.type) !== null) void showAlready(known, d);
              else advance({ ...d, tagCode });
            }}
            onNoTag={() => advance({ ...d, tagCode: null })}
          />
        );
      case 'owner':
        return <ChoiceStep question={OWNER_QUESTION} value={d.answers.ownerType} onPick={(ownerType) => advance({ ...d, answers: { ...d.answers, ownerType } })} />;
      case 'material':
        return <ChoiceStep question={MATERIAL_QUESTION} value={d.answers.material} onPick={(material) => advance({ ...d, answers: { ...d.answers, material } })} />;
      case 'boxKind':
        return <ChoiceStep question={BOX_QUESTION} value={d.answers.boxKind} onPick={(boxKind) => advance({ ...d, answers: { ...d.answers, boxKind } })} />;
      case 'customer': {
        const here = gps.samples.length ? (gps.decision.fix ? ([gps.decision.fix.lat, gps.decision.fix.lng] as LatLng) : ([gps.samples.at(-1)!.lat, gps.samples.at(-1)!.lng] as LatLng)) : d.location ? ([d.location.lat, d.location.lng] as LatLng) : undefined;
        return <CustomerStep customers={customers} here={here} allowNotListed={d.kind === 'drop'} onPick={(c) => advance({ ...d, customerId: c ? c.id : null })} />;
      }
      case 'pad': {
        const customer = customers.find((c) => c.id === d.customerId);
        return (
          <PadStep
            digits={d.rxDigits ?? ''}
            onDigits={(rxDigits) => update({ ...d, rxDigits })}
            photoId={d.photoId}
            customerName={customer?.name ?? '?'}
            field={field.rx}
            optical={optical}
            saving={saving}
            onSave={() => void save()}
            onFix={() => setScreen({ name: 'fix' })}
          />
        );
      }
      case 'summary':
        return renderSummary(d);
    }
  }

  function renderSummary(d: CaptureDraft) {
    const location = d.location;
    const answers: { picture: string; label: MessageKey }[] = [];
    const pick = <V extends string>(q: { options: { value: V; picture: string; label: MessageKey }[] }, v?: V) => {
      const option = q.options.find((o) => o.value === v);
      if (option) answers.push(option);
    };
    if (d.kind === 'pole') {
      pick(OWNER_QUESTION, d.answers.ownerType);
      pick(MATERIAL_QUESTION, d.answers.material);
    }
    if (d.kind === 'box') pick(BOX_QUESTION, d.answers.boxKind);
    const customer = d.customerId ? customers.find((c) => c.id === d.customerId) : undefined;
    const rough = location && !location.officeMustPlace && (location.accuracyMeters ?? Infinity) > field.gps.acceptMeters;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-testid="summary">
          <StepTitle k="summary.title" />
          <div className="flex gap-3">
            {d.photoId && <PhotoView photoId={d.photoId} className="h-36 w-28 shrink-0 rounded-2xl border-2 border-slate-900" />}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <img src={TILE_PICTURES[d.kind]} alt="" className="h-12 w-12" />
              {answers.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-[1.125rem] font-semibold text-slate-900">
                  <img src={a.picture} alt="" className="h-9 w-9 shrink-0" />
                  <Say k={a.label} />
                </div>
              ))}
              {customer && <p className="text-[1.125rem] font-semibold text-slate-900">{t('summary.customer', { name: customer.name })}</p>}
              {(d.kind === 'pole' || d.kind === 'box') && (
                <p className="text-[1rem] font-semibold text-slate-900">{d.tagCode ? t('summary.tag', { tag: d.tagCode }) : t('tag.none')}</p>
              )}
              {d.previousName && <p className="text-[1rem] text-slate-700">{t('summary.after', { name: d.previousName })}</p>}
            </div>
          </div>
          <p
            data-testid="summary-location"
            data-state={location?.officeMustPlace ? 'office' : rough ? 'rough' : 'good'}
            className={cx(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-[1.125rem] font-bold',
              location?.officeMustPlace || rough ? 'bg-amber-200 text-slate-900' : 'bg-emerald-100 text-emerald-950',
            )}
          >
            {location?.officeMustPlace || rough ? <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden /> : <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden />}
            {location?.officeMustPlace ? t('summary.officePlace') : rough ? t('gps.rough') : t('gps.good')}
          </p>
          {location && <MiniMap lat={location.lat} lng={location.lng} approximate={location.officeMustPlace} />}
          {d.kind === 'danger' && <SafetyReminder />}
          {saveFailed && (
            <p className="rounded-xl bg-red-800 p-3 text-[1.125rem] font-bold text-white" data-testid="save-failed">
              {t('saved.failed')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t-2 border-slate-900 bg-white p-3">
          <div className="w-1/3">
            <MidButton icon={Wrench} onClick={() => setScreen({ name: 'fix' })} testId="fix">
              {t('summary.fix')}
            </MidButton>
          </div>
          <div className="flex-1">
            <BigButton tone="go" icon={Save} onClick={() => void save()} disabled={saving} testId="save">
              {saving ? t('summary.saving') : saveFailed ? t('common.tryAgain') : t('summary.save')}
            </BigButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div lang={lang} className="field-capture fixed inset-0 z-[1500] flex flex-col bg-slate-50 text-slate-900" data-testid="capture-root">
      <TopBar
        onHome={() => {
          // Home in the middle of a capture: keep it if it has a photo, so nothing taken is lost.
          if (draft && (screen.name === 'flow' || screen.name === 'fix')) {
            if (draft.photoId) setPaused(draft);
            else void captureService.discardDraft(draft).catch(() => undefined);
          }
          goHome();
        }}
        showHome={screen.name !== 'home' && screen.name !== 'loading'} />
      {screen.name === 'flow' && screen.resumed && (
        <p className="shrink-0 bg-blue-800 px-3 py-1 text-[1rem] font-semibold text-white" data-testid="resumed">
          {t('home.resumed')}
        </p>
      )}
      <main className="flex min-h-0 flex-1 flex-col">{body}</main>
    </div>
  );
}
