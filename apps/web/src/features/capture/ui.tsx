import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, CloudUpload, Home, Loader2, type LucideIcon, Smartphone, Volume2, WifiOff } from 'lucide-react';

import { canPlayClip, playClip, useAudioManifest } from '../../i18n/audio';
import { type MessageKey, MESSAGES } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { useSyncStore } from '../../stores/syncStore';
import { captureService } from './captureRuntime';
import { useCaptureStatus } from './captureService';
import { cx } from './feedback';


/** Shows a speaker only where a recorded clip of final (reviewed) words exists. Today: nowhere. */
export function SpeakButton({ k }: { k: MessageKey }) {
  const { t, lang } = useT();
  const manifest = useAudioManifest((s) => s.manifest);
  if (!canPlayClip(manifest, MESSAGES, lang, k)) return null;
  return (
    <button
      type="button"
      aria-label={t('common.listen')}
      onClick={(e) => {
        e.stopPropagation();
        playClip(lang, k);
      }}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-slate-900 bg-white text-slate-900"
    >
      <Volume2 className="h-6 w-6" aria-hidden />
    </button>
  );
}

/** Text for a key, marked with the language actually used (English when the draft has none). */
export function Say({ k, values, className }: { k: MessageKey; values?: Record<string, string | number>; className?: string }) {
  const { tr, lang } = useT();
  const result = tr(k, values);
  return (
    <span className={className} lang={result.lang !== lang ? result.lang : undefined}>
      {result.text}
    </span>
  );
}

type Tone = 'primary' | 'go' | 'danger' | 'plain';

const TONES: Record<Tone, string> = {
  primary: 'bg-blue-800 text-white border-blue-900',
  go: 'bg-emerald-800 text-white border-emerald-900',
  danger: 'bg-red-800 text-white border-red-900',
  plain: 'bg-white text-slate-900 border-slate-900',
};

/** The main action: full width, at least 72 px tall. */
export function BigButton({
  tone = 'primary',
  icon: Icon,
  children,
  onClick,
  disabled,
  testId,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cx(
        'flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl border-2 px-4 py-3 text-[1.25rem] font-bold leading-tight disabled:opacity-50',
        TONES[tone],
      )}
    >
      {Icon && <Icon className="h-8 w-8 shrink-0" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

/** A routine control: 64 px tall. */
export function MidButton({
  icon: Icon,
  children,
  onClick,
  tone = 'plain',
  testId,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  tone?: Tone;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cx('flex min-h-[4rem] w-full items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2 text-[1.125rem] font-semibold leading-tight', TONES[tone])}
    >
      {Icon && <Icon className="h-6 w-6 shrink-0" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

/** A picture choice. One tap answers and moves on. */
export function PictureChoice({
  picture,
  label,
  speak,
  onPick,
  selected,
  testId,
}: {
  picture: React.ReactNode;
  label: React.ReactNode;
  speak?: MessageKey;
  onPick: () => void;
  selected?: boolean;
  testId?: string;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        data-testid={testId}
        aria-pressed={selected}
        className={cx(
          'flex min-h-[9rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 bg-white p-3 text-center text-[1.125rem] font-semibold leading-snug text-slate-900',
          selected ? 'border-blue-800 ring-4 ring-blue-800/40' : 'border-slate-900',
        )}
      >
        <span className="flex h-20 w-20 items-center justify-center" aria-hidden>
          {picture}
        </span>
        <span>{label}</span>
        {selected && <Check className="absolute right-2 top-2 h-7 w-7 text-blue-800" aria-hidden />}
      </button>
      {speak && (
        <span className="absolute left-1 top-1">
          <SpeakButton k={speak} />
        </span>
      )}
    </div>
  );
}

/** A photo stored on this phone, or one the server holds. */
export function PhotoView({ photoId, url, className, alt = '' }: { photoId?: string; url?: string; className?: string; alt?: string }) {
  const [local, setLocal] = useState<{ photoId: string; src: string | null } | null>(null);
  useEffect(() => {
    if (!photoId) return undefined;
    let objectUrl: string | null = null;
    let cancelled = false;
    captureService
      .getPhoto(photoId)
      .then((photo) => {
        if (cancelled) return;
        objectUrl = photo ? URL.createObjectURL(photo.blob) : null;
        setLocal({ photoId, src: objectUrl });
      })
      .catch(() => !cancelled && setLocal({ photoId, src: null }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);
  // The phone's own copy first; the server copy when this phone never had it.
  const loaded = photoId && local?.photoId === photoId;
  const src = photoId ? (loaded ? (local.src ?? url ?? null) : null) : (url ?? null);
  if (!src) return <div className={cx('bg-slate-200', className)} aria-hidden />;
  return <img src={src} alt={alt} className={cx('object-cover', className)} />;
}

/**
 * Always visible in capture: "Saved on phone N", "Sending", "Sent to office", or "Not saved on
 * phone" in red. Each state has its own icon and words, never colour alone.
 */
export function SyncChip() {
  const { t } = useT();
  const status = useCaptureStatus();
  const phase = useSyncStore((s) => s.phase);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  let icon: React.ReactNode;
  let text: string;
  let tone: string;
  let state: string;
  if (status.storageError) {
    icon = <AlertTriangle className="h-6 w-6" aria-hidden />;
    text = t('sync.notSaved');
    tone = 'bg-red-800 text-white border-red-900';
    state = 'not-saved';
  } else if (status.waitingCount > 0 && online && (status.uploading || phase === 'saving' || phase === 'pending')) {
    icon = <CloudUpload className="h-6 w-6 animate-pulse" aria-hidden />;
    text = `${t('sync.sending')} ${status.waitingCount}`;
    tone = 'bg-amber-200 text-slate-900 border-amber-700';
    state = 'sending';
  } else if (status.waitingCount > 0) {
    icon = online ? <Smartphone className="h-6 w-6" aria-hidden /> : <WifiOff className="h-6 w-6" aria-hidden />;
    text = t('sync.saved', { count: status.waitingCount });
    tone = 'bg-amber-200 text-slate-900 border-amber-700';
    state = 'saved';
  } else {
    icon = <Check className="h-6 w-6" aria-hidden />;
    text = t('sync.sent');
    tone = 'bg-emerald-100 text-emerald-950 border-emerald-800';
    state = 'sent';
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="status"
        aria-live="polite"
        data-testid="sync-chip"
        data-state={state}
        className={cx('flex min-h-[3rem] items-center gap-2 rounded-full border-2 px-3 text-[1rem] font-bold', tone)}
      >
        {icon}
        <span>{text}</span>
      </div>
      {status.refusedCount > 0 && (
        <div className="rounded-lg bg-red-800 px-2 py-1 text-[0.875rem] font-semibold text-white">{t('sync.refused', { count: status.refusedCount })}</div>
      )}
    </div>
  );
}

export function TopBar({ onHome, showHome = true }: { onHome: () => void; showHome?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex shrink-0 items-start justify-between gap-2 border-b-2 border-slate-900 bg-white px-3 py-2">
      {showHome ? (
        <button
          type="button"
          onClick={onHome}
          className="flex min-h-[3rem] min-w-[3rem] items-center gap-1 rounded-xl border-2 border-slate-900 bg-white px-2 text-[1rem] font-semibold text-slate-900"
        >
          <Home className="h-6 w-6" aria-hidden />
          <span>{t('common.home')}</span>
        </button>
      ) : (
        <span />
      )}
      <SyncChip />
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 p-6 text-[1.125rem] font-semibold text-slate-900">
      <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
