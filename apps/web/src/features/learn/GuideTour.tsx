import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Hand,
  ListChecks,
  Pause,
  Play,
  Pointer,
  RotateCcw,
  Route,
  Volume2,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { GUIDE_TOURS, type GuideTourId, isVoiceLanguage } from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import { useT } from '../../i18n/useT';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore, wasMadeHere } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { AUTO, hideHand, type Pilot, removeDemoItems, StopDemo } from './guideAutopilot';
import {
  findTarget,
  type GuideCtx,
  type GuideStep,
  guideSteps,
  type GuideWorld,
  scrollBarToTarget,
  startCtx,
  stepTargets,
  updateCtx,
} from './guideTours';
import { LanguagePicker } from './LanguagePicker';
import { useLearnStore } from './learnStore';
import { scriptOf, speakId } from './voiceLibrary';
import { useVoicePlayer } from './voicePlayer';

const BIG = 'flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-2 px-4 text-[16px] font-bold';
const SMALL = 'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 px-3 text-[15px] font-bold';
const PAD = 8;
const NO_CTX: GuideCtx = { baseline: { equipment: [], cables: [], customers: [], splitters: [] } };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The window the lit part is in, if any: the card goes beside it rather than over it. */
  frame?: { left: number; right: number };
}

/** The automatic voice for a step in the chosen language (none for a language Sarvam does not speak). */
function useClipFor() {
  const { lang } = useT();
  return useCallback((key: string) => (isVoiceLanguage(lang) ? { id: speakId(key, lang) } : undefined), [lang]);
}

/** How long to leave the words on screen when there is no voice: about the time to read them aloud. */
const readingMs = (words: string) => Math.min(16000, Math.max(4000, words.split(/\s+/).length * 430));

/** Where a new item the person made is, so the map can be moved to it. */
function positionOf(kind: NonNullable<GuideStep['bringIntoView']>, ctx: GuideCtx | null) {
  const { equipment, customers } = useNetworkStore.getState();
  const id = ctx?.[kind];
  if (!id) return null;
  const item = kind === 'customer' ? customers.find((c) => c.id === id) : equipment.find((e) => e.id === id);
  return item && Number.isFinite(item.lat) && Number.isFinite(item.lng) ? { lat: item.lat, lng: item.lng } : null;
}

/** Follows the lit-up element as the screen moves (the map pans, a window opens, the phone turns). */
function useTargetBox(step: GuideStep, ctx: GuideCtx | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  useEffect(() => {
    let timer = 0;
    let tries = 0;
    const tick = () => {
      const targets = stepTargets(step, ctxRef.current ?? NO_CTX);
      const found = targets.map(findTarget).find(Boolean);
      // Not in sight yet (a list still opening, a bar scrolled away): scroll it into view a few times.
      if (!found && tries < 8) {
        tries += 1;
        targets.forEach(scrollBarToTarget);
      }
      const r = found?.getBoundingClientRect();
      const f = found?.closest('[role="dialog"], .fixed.inset-0 > .shadow-2xl')?.getBoundingClientRect();
      setBox((old) => {
        if (!r) return old === null ? old : null;
        const next: Box = {
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          ...(f ? { frame: { left: f.left, right: f.right } } : {}),
        };
        if (
          old &&
          Math.abs(old.x - next.x) < 1 &&
          Math.abs(old.y - next.y) < 1 &&
          Math.abs(old.w - next.w) < 1 &&
          Math.abs(old.h - next.h) < 1 &&
          old.frame?.left === next.frame?.left
        )
          return old;
        return next;
      });
      timer = window.setTimeout(tick, 150);
    };
    timer = window.setTimeout(tick, 60);
    return () => window.clearTimeout(timer);
  }, [step]);
  return box;
}

/**
 * Where the card goes. Next to the lit-up part when there is one; at the bottom for the menu tour,
 * so the page shows; out of the way when the person must tap the map.
 */
function cardPosition(
  box: Box | null,
  cardH: number,
  mode: 'near' | 'bottom' | 'aside',
  compact = false,
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 768;
  const w = Math.min(compact ? 340 : mode === 'aside' ? 400 : 460, vw - 24);
  // The map guides on a computer: a small card kept in the bottom-left corner, so the map being
  // mapped stays in view (the ring and the hand show what to tap). Bottom-right when the lit-up
  // thing is in that corner.
  if (compact && !phone) {
    const maxHeight = vh * 0.45;
    const h = Math.min(cardH || maxHeight, maxHeight);
    const corner = { x: 16, y: vh - 20 - h, w, h };
    const covered =
      !!box &&
      box.x < corner.x + corner.w + PAD &&
      box.x + box.w > corner.x - PAD &&
      box.y < corner.y + corner.h + PAD &&
      box.y + box.h > corner.y - PAD;
    return covered ? { width: w, right: 16, bottom: 20, maxHeight } : { width: w, left: 16, bottom: 20, maxHeight };
  }
  if (compact && phone && (mode !== 'near' || !box)) return { width: w, left: 12, bottom: 12, maxHeight: vh * 0.34 };
  if (mode === 'aside') {
    // Phone: under the top bar (the map toolbar is at the bottom). Computer: bottom middle.
    return phone ? { width: w, left: 12, top: 96, maxHeight: vh * 0.42 } : { width: w, left: (vw - w) / 2, bottom: 40 };
  }
  if (mode === 'bottom' || !box) return { width: w, left: (vw - w) / 2, bottom: phone ? 12 : 28, maxHeight: vh * 0.5 };
  // Inside a window with room beside it (a computer screen): put the card next to the window.
  const frame = box.frame;
  if (frame) {
    const top = Math.max(12, Math.min(box.y + box.h / 2 - cardH / 2, vh - cardH - 12));
    if (vw - frame.right >= w + 28) return { width: w, left: frame.right + 16, top };
    if (frame.left >= w + 28) return { width: w, left: frame.left - w - 16, top };
  }
  const left = Math.min(Math.max(12, box.x + box.w / 2 - w / 2), vw - w - 12);
  const below = box.y + box.h + PAD + 52;
  const roomBelow = vh - 12 - below;
  const roomAbove = box.y - PAD - 24;
  if (cardH <= roomBelow) return { width: w, left, top: below };
  if (cardH <= roomAbove) return { width: w, left, top: box.y - PAD - 12 - cardH };
  if (roomBelow >= roomAbove) return { width: w, left, top: below, maxHeight: Math.max(200, roomBelow) };
  const maxHeight = Math.max(200, roomAbove);
  return { width: w, left, top: Math.max(12, box.y - PAD - 12 - Math.min(cardH, maxHeight)), maxHeight };
}

function Pictures({ types, chain, small = false }: { types: string[]; chain: boolean; small?: boolean }) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-b from-slate-50 to-white p-1.5 ring-1 ring-slate-100"
      aria-hidden
    >
      {types.map((type, i) => (
        <span key={type} className="flex items-center gap-1.5">
          {chain && i > 0 && <ArrowRight className={small ? 'h-4 w-4 text-blue-600' : 'h-5 w-5 text-blue-600'} strokeWidth={2.5} />}
          <span className="flex flex-col items-center">
            <EquipmentIllustration type={type} size={small ? 30 : 46} />
            <span className="text-[11px] font-semibold text-slate-600" lang="en">
              {type}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

function Tour({ tour }: { tour: GuideTourId }) {
  const { t, lang } = useT();
  const stepIndex = useLearnStore((s) => s.tourStep);
  const replay = useLearnStore((s) => s.tourReplay);
  const ctx = useLearnStore((s) => s.tourCtx);
  const setTourStep = useLearnStore((s) => s.setTourStep);
  const closeTour = useLearnStore((s) => s.closeTour);
  // Kept between redraws, so a step's timers and map move are not restarted on every redraw.
  const steps = useMemo(() => guideSteps(tour), [tour]);
  const index = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const step = steps[index];
  const last = index === steps.length - 1;
  const menu = tour === 'menu';
  // The guide maps by itself on the real map: it says each step, then does it, without waiting.
  const demo = tour === 'demo';
  // The map guides use a small card, so the map stays in view; the words can be folded away too.
  const compact = !menu;
  const [wordsHidden, setWordsHidden] = useState(false);

  /* -------- pages and windows (menu tour); the mapping guide works on the map */
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    // Only when the step changes: the person may open other pages while doing a step.
    const want = step.route ?? (menu ? undefined : '/');
    if (want && pathRef.current !== want) navigate(want);
  }, [step, menu, navigate]);
  useEffect(() => {
    const id = step.modal;
    if (!id) return;
    const wasOpen = !!useUiStore.getState().modals[id];
    if (!wasOpen) useUiStore.getState().setModalOpen(id, true);
    return () => {
      if (!wasOpen) useUiStore.getState().setModalOpen(id, false);
    };
  }, [step]);

  /* -------- mapping guide: notice what the person makes */
  useEffect(() => {
    if (menu) return;
    const check = () => {
      const current = useLearnStore.getState().tourCtx;
      if (!current) return;
      const next = updateCtx(current, useNetworkStore.getState(), wasMadeHere);
      if (next !== current) useLearnStore.getState().setTourCtx(next);
    };
    check();
    return useNetworkStore.subscribe(check);
  }, [menu]);

  /* -------- move the map to the new item when it is off screen (only the view moves) */
  useEffect(() => {
    const kind = step.bringIntoView;
    if (!kind) return;
    const timer = window.setTimeout(() => {
      const current = useLearnStore.getState().tourCtx;
      if (stepTargets(step, current ?? NO_CTX).some((tg) => findTarget(tg))) return;
      const at = positionOf(kind, current);
      if (at) useMapStore.getState().flyTo(at.lat, at.lng, 18);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (!demo) return;
    const { viewport } = useMapStore.getState();
    if (viewport.zoom < 16) useMapStore.getState().flyTo(viewport.lat, viewport.lng, 17);
  }, [demo]);

  const box = useTargetBox(step, ctx);

  /* -------- voice: plays by itself on each step (the guide was opened with a tap) */
  const clipOf = useClipFor();
  const clip = clipOf(step.key);
  const clipId = clip?.id;
  const player = useVoicePlayer();
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  /** False once the guide is closed, so the demo's hand stops at once. */
  const aliveRef = useRef(true);
  useEffect(() => {
    // Set again on every mount: React's development mode mounts twice.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      hideHand();
    };
  }, []);
  const [autoError, setAutoError] = useState<string | null>(null);
  useEffect(() => {
    if (!clipId || pausedRef.current) return;
    useVoicePlayer.getState().play(clipId);
  }, [step.key, clipId]);
  useEffect(() => () => useVoicePlayer.getState().stop(), []);
  const mine = !!clip && player.clipId === clip.id;
  const speaking = mine && (player.phase === 'playing' || player.phase === 'loading');

  const script = scriptOf(step.key);
  const words = script && isVoiceLanguage(lang) ? script.text[lang] : undefined;
  const wordsText = words?.text ?? '';

  /* -------- moving on: after the voice (say), or once the person has done it (do) */
  const [isDone, setIsDone] = useState(false);
  const finish = useCallback(() => {
    useVoicePlayer.getState().stop();
    closeTour(true);
    if (menu) navigate('/');
  }, [closeTour, menu, navigate]);
  useEffect(() => {
    const enteredAt = Date.now();
    const readFor = readingMs(wordsText);
    let doneSince = 0;
    let shownDone = false;
    let acting = false;
    const pilot: Pilot = {
      alive: () => aliveRef.current,
      paused: () => pausedRef.current,
      ctx: () => useLearnStore.getState().tourCtx ?? NO_CTX,
    };
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      const voice = useVoicePlayer.getState();
      const thisClip = clipOf(step.key);
      const playingThis =
        !!thisClip && voice.clipId === thisClip.id && (voice.phase === 'playing' || voice.phase === 'loading');
      const elapsed = Date.now() - enteredAt;
      const heard =
        (!!thisClip && voice.clipId === thisClip.id && voice.phase === 'ended') ||
        (!playingThis && elapsed > readFor + (thisClip ? 2500 : 0));
      const goOn = () => (last ? finish() : setTourStep(index + 1));

      if (step.kind === 'say') {
        if (heard) goOn();
        return;
      }
      const ui = useUiStore.getState();
      const map = useMapStore.getState();
      const world: GuideWorld = {
        ctx: useLearnStore.getState().tourCtx ?? NO_CTX,
        map: { activeTool: map.activeTool, drawTarget: map.drawTarget, equipmentTypeToAdd: map.equipmentTypeToAdd },
        modals: ui.modals,
        selected: ui.selectedObject ? { type: ui.selectedObject.type, id: ui.selectedObject.data.id } : null,
        enteredAt,
      };
      const done = !!step.done?.(world);
      if (done !== shownDone) {
        shownDone = done;
        setIsDone(done);
      }
      // The demo: once the step has been said, the guide does it itself.
      const act = demo ? AUTO[step.key] : undefined;
      if (act && !done && heard && !acting) {
        acting = true;
        setAutoError(null);
        act(pilot).catch((error: unknown) => {
          if (error instanceof StopDemo || !aliveRef.current) return;
          acting = false;
          setAutoError(error instanceof Error ? error.message : String(error));
          setPaused(true);
        });
      }
      if (!done) {
        doneSince = 0;
        return;
      }
      // Reached with Back: say it again first. Already done when reached: go straight on.
      if (replay && !heard) return;
      if (!replay && elapsed < 400) return goOn();
      doneSince ||= Date.now();
      // Done while still speaking: let the sentence finish (at most a few seconds), then go on.
      if (playingThis && Date.now() - doneSince < 6000) return;
      if (Date.now() - doneSince < 700) return;
      goOn();
    }, 250);
    return () => {
      window.clearInterval(timer);
      setIsDone(false);
    };
  }, [step, index, last, replay, wordsText, clipOf, setTourStep, finish, demo]);

  const back = () => {
    useVoicePlayer.getState().stop();
    setPaused(false);
    setTourStep(index - 1, true);
  };
  const togglePause = () => {
    if (!paused) {
      setPaused(true);
      if (speaking) player.pause();
      return;
    }
    setPaused(false);
    if (clip) {
      if (mine && player.phase === 'paused') player.resume();
      else player.play(clip.id);
    }
  };
  const close = () => {
    useVoicePlayer.getState().stop();
    aliveRef.current = false;
    hideHand();
    if (demo) {
      // Stopped early: remove what the demo made; if something cannot be removed now, the place is
      // kept so it is removed the next time the app opens.
      void removeDemoItems(useLearnStore.getState().tourCtx).then((left) => closeTour(left.length === 0));
      return;
    }
    closeTour();
    if (menu) navigate('/');
  };

  /* -------- the card */
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(300);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    // The card's full height even while it is squeezed, so squeezing it never changes where it goes.
    const measure = () =>
      setCardH([...el.children].reduce((sum, child) => sum + (child as HTMLElement).scrollHeight, 0));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    [...el.children].forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, []);
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const doing = step.kind === 'do';
  const missing = doing && !step.mapTap && stepTargets(step, ctx ?? NO_CTX).length > 0 && !box;
  const mode = step.mapTap ? 'aside' : menu ? 'bottom' : 'near';
  // The menu tour and the spoken intro and ending only show: taps are caught. Hands-on steps let
  // the person use the real screen, so nothing is caught and the map is not darkened.
  // The demo works the screen itself, so the person's taps are caught for the whole demo.
  const blocks = step.kind === 'say' || demo;
  const dim = step.mapTap ? 0 : menu ? 0.38 : doing ? 0.45 : 0.6;
  const title = menu ? t('learn.guideMenu') : demo ? t('learn.guideMap') : t('learn.guideTry');

  return createPortal(
    <div
      data-guide-layer
      className={`fixed inset-0 z-[3500] ${blocks ? '' : 'pointer-events-none'}`}
      data-testid="guide-tour"
      data-step={step.key}
      data-done={isDone ? '1' : '0'}
    >
      {blocks && <div className="absolute inset-0" data-guide-blocker aria-hidden />}
      {box ? (
        <>
          {dim > 0 && (
            <div
              className="pointer-events-none fixed rounded-xl transition-all duration-300 ease-out"
              style={{
                left: box.x - PAD,
                top: box.y - PAD,
                width: box.w + PAD * 2,
                height: box.h + PAD * 2,
                boxShadow: `0 0 0 9999px rgb(2 6 23 / ${dim})`,
              }}
              aria-hidden
            />
          )}
          <div
            className="guide-ring pointer-events-none fixed rounded-xl"
            style={{ left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 }}
            aria-hidden
          />
          <Pointer
            className="guide-hand pointer-events-none fixed h-11 w-11 fill-white text-slate-900 drop-shadow-lg"
            style={{
              left: Math.min(box.x + box.w / 2 - 14, window.innerWidth - 48),
              top: Math.min(box.y + box.h + PAD + 2, window.innerHeight - 48),
            }}
            strokeWidth={1.6}
            aria-hidden
          />
        </>
      ) : (
        dim > 0 && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `rgb(2 6 23 / ${dim})` }}
            aria-hidden
          />
        )
      )}

      <div
        ref={card}
        data-guide-card
        role="dialog"
        aria-modal={blocks}
        aria-labelledby="guide-title"
        lang={lang}
        className="animate-pop-in pointer-events-auto fixed flex max-h-[calc(100vh-24px)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/10 transition-[left,top] duration-300 ease-out"
        style={cardPosition(box, cardH, mode, compact)}
      >
        <div className={`flex items-center gap-2 border-b border-slate-100 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
          <span
            className={`ui-brand flex shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}
            aria-hidden
          >
            <Volume2 className={`h-5 w-5 ${speaking ? 'animate-pulse' : ''}`} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="guide-title" className={`truncate font-bold text-slate-900 ${compact ? 'text-[14px]' : 'text-[15px]'}`}>
              {title}
            </h2>
            <p
              className={`truncate font-semibold text-slate-500 ${compact ? 'text-[12px]' : 'text-[13px]'}`}
              data-testid="guide-step"
            >
              {t('learn.step', { n: index + 1, total: steps.length })}
              {script && <span lang="en"> · {script.title}</span>}
            </p>
          </div>
          {compact && (
            <button
              type="button"
              onClick={() => setWordsHidden((h) => !h)}
              aria-label={wordsHidden ? t('learn.showWords') : t('learn.hideWords')}
              title={wordsHidden ? t('learn.showWords') : t('learn.hideWords')}
              aria-expanded={!wordsHidden}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
              data-testid="guide-fold"
            >
              {wordsHidden ? <ChevronUp className="h-6 w-6" aria-hidden /> : <ChevronDown className="h-6 w-6" aria-hidden />}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={t('learn.guideClose')}
            title={t('learn.guideClose')}
            className={`flex shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 ${compact ? 'h-11 w-11' : 'h-12 w-12'}`}
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        <div className={`flex gap-1 px-3 ${compact ? 'pt-1.5' : 'pt-2'}`} aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s.key}
              className={`flex-1 rounded-full ${compact ? 'h-1' : 'h-1.5'} ${i <= index ? 'bg-blue-600' : 'bg-slate-200'}`}
            />
          ))}
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'space-y-1.5 p-2.5' : 'space-y-2.5 p-3'} ${wordsHidden && !autoError ? 'hidden' : ''}`}
        >
          {step.pictures && (
            <Pictures types={step.pictures} chain={!menu && step.pictures.length > 1} small={compact} />
          )}
          <p
            className={`text-slate-900 ${compact ? 'text-[15px] leading-snug' : 'text-[17px] leading-relaxed'}`}
            data-testid="guide-words"
          >
            {wordsText}
          </p>
          {script?.terms && !compact && (
            <div className="flex flex-wrap gap-1.5" lang="en">
              {script.terms.map((term) => (
                <span
                  key={term}
                  className="rounded-lg bg-blue-50 px-2 py-0.5 text-[13px] font-bold text-blue-800 ring-1 ring-blue-100"
                >
                  {term}
                </span>
              ))}
            </div>
          )}
          {doing && (
            <p
              data-testid={isDone ? 'guide-done' : 'guide-your-turn'}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[15px] font-bold ring-1 ${isDone ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
            >
              {isDone ? (
                <Check className="h-5 w-5 shrink-0" aria-hidden />
              ) : (
                <Hand className="h-5 w-5 shrink-0 animate-pulse" aria-hidden />
              )}
              {isDone ? t('learn.done') : demo ? t('learn.watching') : t('learn.yourTurn')}
            </p>
          )}
          {autoError && (
            <p
              className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800 ring-1 ring-red-200"
              role="alert"
              data-testid="guide-auto-error"
            >
              {t('learn.autoFailed')}{' '}
              <span className="block text-[12px] font-normal" lang="en">
                {autoError}
              </span>
            </p>
          )}
          {missing && !demo && (
            <p
              className="rounded-xl bg-slate-50 px-3 py-2 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200"
              data-testid="guide-missing"
            >
              {t('learn.notOnScreen')}
            </p>
          )}
          {(!clip || (mine && player.phase === 'error')) && (
            <p className="flex items-start gap-2 text-[13px] font-medium text-slate-600" data-testid="guide-no-voice">
              <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              {t('learn.noVoice')}
            </p>
          )}
          {words && !words.reviewed && <p className="text-[12px] text-slate-500">{t('learn.draftWords')}</p>}
          {index === 0 && (
            <p className="text-[12px] text-slate-500">
              {menu ? t('learn.guideOnly') : demo ? t('learn.demoNote') : t('learn.guideReal')}
            </p>
          )}
        </div>

        <div className={`flex gap-2 border-t border-slate-100 ${compact ? 'p-2' : 'p-2.5'}`}>
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              className={`${compact ? SMALL : BIG} flex-1 border-slate-300 bg-white text-slate-900`}
              data-testid="guide-back"
            >
              <ArrowLeft className="h-6 w-6" aria-hidden />
              {t('learn.back')}
            </button>
          )}
          <button
            type="button"
            onClick={togglePause}
            className={`${compact ? SMALL : BIG} ui-brand flex-1 border-blue-800 bg-blue-700 text-white`}
            data-testid={paused ? 'guide-play' : 'guide-pause'}
          >
            {paused ? <Play className="h-6 w-6" aria-hidden /> : <Pause className="h-6 w-6" aria-hidden />}
            {paused ? t('learn.play') : t('learn.pause')}
          </button>
          {clip && (
            <button
              type="button"
              onClick={() => {
                setPaused(false);
                if (mine) player.repeat();
                else player.play(clip.id);
              }}
              aria-label={t('learn.repeat')}
              title={t('learn.repeat')}
              className={`${compact ? SMALL : BIG} ${compact ? 'w-[48px]' : 'w-[56px]'} shrink-0 border-slate-300 bg-white px-0 text-slate-900`}
              data-testid="guide-repeat"
            >
              <RotateCcw className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The choice of guides, with "continue where you stopped" first when a guide was left unfinished. */
function Chooser() {
  const { t, lang } = useT();
  const saved = useLearnStore((s) => s.tourSaved);
  const openTour = useLearnStore((s) => s.openTour);
  const resumeTour = useLearnStore((s) => s.resumeTour);
  const closeTour = useLearnStore((s) => s.closeTour);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTour();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeTour]);
  const start = (id: GuideTourId) => openTour(id, id === 'menu' ? null : startCtx(useNetworkStore.getState()));
  const label = (id: GuideTourId) =>
    id === 'menu' ? t('learn.guideMenu') : id === 'demo' ? t('learn.guideMap') : t('learn.guideTry');
  const resumable = saved && saved.tour !== 'demo';
  const choice = (id: GuideTourId, Icon: typeof Route, pictures: string[]) => (
    <button
      type="button"
      onClick={() => start(id)}
      data-testid={`guide-open-${id}`}
      className="flex min-h-[80px] w-full items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white p-3 text-left hover:border-blue-500 hover:bg-blue-50"
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"
        aria-hidden
      >
        <Icon className="h-7 w-7" />
      </span>
      <span className="min-w-0 flex-1 text-[18px] font-bold text-slate-900">
        {label(id)}
        {saved?.tour === id && (
          <span className="block text-[13px] font-semibold text-slate-500">{t('learn.startAgain')}</span>
        )}
      </span>
      <span className="hidden shrink-0 gap-1 sm:flex" aria-hidden>
        {pictures.map((p) => (
          <EquipmentIllustration key={p} type={p} size={34} />
        ))}
      </span>
    </button>
  );
  return createPortal(
    <div
      data-guide-layer
      className="fixed inset-0 z-[3500] flex items-center justify-center bg-slate-950/55 p-3"
      data-testid="guide-chooser"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-choose-title"
        lang={lang}
        className="animate-pop-in w-full max-w-md space-y-3 rounded-3xl bg-white p-4 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <span
            className="ui-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"
            aria-hidden
          >
            <Volume2 className="h-6 w-6" />
          </span>
          <h2 id="guide-choose-title" className="flex-1 text-[19px] font-bold text-slate-900">
            {t('learn.guideChoose')}
          </h2>
          <button
            type="button"
            onClick={() => closeTour()}
            aria-label={t('learn.guideClose')}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        {/* The guide speaks and shows its words in the language chosen here. */}
        <LanguagePicker />
        {resumable && (
          <button
            type="button"
            onClick={resumeTour}
            data-testid="guide-resume"
            className="ui-brand flex min-h-[80px] w-full items-center gap-3 rounded-2xl border-2 border-blue-800 bg-blue-700 p-3 text-left text-white"
          >
            <Play className="h-8 w-8 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[18px] font-bold">{t('learn.continue')}</span>
              <span className="block text-[14px] text-blue-100">
                {label(saved.tour)} · {t('learn.step', { n: saved.step + 1, total: GUIDE_TOURS[saved.tour].length })}
              </span>
            </span>
          </button>
        )}
        {choice('menu', ListChecks, ['OLT', 'FAT'])}
        {choice('demo', Play, ['OLT', 'FDT', 'FAT', 'ONT'])}
        {choice('map', Route, ['OLT', 'FAT', 'ONT'])}
        <p className="text-[13px] text-slate-500">{t('learn.demoNote')}</p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The on-screen guide with voice (learning assistant, Stage 3): a tour of every menu page, and
 * mapping from the OLT to a house with the person doing each step on the real map while the guide
 * lights up where to tap, explains it aloud and waits. Opened from the Guide button or Help.
 */
export function GuideTour() {
  const tour = useLearnStore((s) => s.tour);
  useEffect(() => {
    const saved = useLearnStore.getState().tourSaved;
    if (saved?.tour !== 'demo' || useLearnStore.getState().tour === 'demo') return;
    let tries = 0;
    // The network may still be loading: try a few times, then let it be.
    const timer = window.setInterval(() => {
      tries += 1;
      void removeDemoItems(saved.ctx).then((left) => {
        if (left.length === 0 || tries >= 6) {
          window.clearInterval(timer);
          if (useLearnStore.getState().tourSaved?.tour === 'demo') useLearnStore.setState({ tourSaved: null });
        }
      });
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);
  if (!tour) return null;
  return tour === 'choose' ? <Chooser /> : <Tour key={tour} tour={tour} />;
}
