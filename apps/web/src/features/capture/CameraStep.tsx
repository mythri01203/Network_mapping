import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RotateCcw, Tag } from 'lucide-react';

import { normalizeTag } from '@fibergis/shared';

import type { MessageKey } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { cx } from './feedback';
import { PermissionHelp } from './HelpPictures';
import { captureVideoFrame, compressImageFile } from './photo';
import { scanVideoFrame } from './qrScanner';
import { BigButton, Say, SpeakButton, Spinner } from './ui';
import { useCameraStream } from './useCamera';

export type GuideShape = 'tall' | 'square' | 'wide' | 'none';

/** The framing guide drawn over the live camera. */
function FramingGuide({ shape }: { shape: GuideShape }) {
  if (shape === 'none') return null;
  const box =
    shape === 'tall'
      ? 'left-[30%] right-[30%] top-[6%] bottom-[6%]'
      : shape === 'square'
        ? 'left-[15%] right-[15%] top-[20%] bottom-[20%]'
        : 'left-[8%] right-[8%] top-[30%] bottom-[30%]';
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={cx('absolute rounded-2xl border-4 border-dashed border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]', box)} />
    </div>
  );
}

function Instruction({ k }: { k: MessageKey }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-slate-900 px-4 py-3 text-[1.25rem] font-bold leading-snug text-white">
      <Say k={k} className="flex-1" />
      <SpeakButton k={k} />
    </div>
  );
}

/** Button that opens the phone's own camera app, for phones where the live view cannot start. */
function NativeCameraButton({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const { t } = useT();
  return (
    <label
      className={cx(
        'flex min-h-[4.5rem] w-full cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-emerald-900 bg-emerald-800 px-4 text-[1.25rem] font-bold text-white',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Camera className="h-8 w-8" aria-hidden />
      <span>{t('camera.open')}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        data-testid="native-camera"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/**
 * Camera first: a live view with a framing guide and one big shutter. If the live view is blocked or
 * missing, the phone's own camera app is offered instead, and the help pictures show how to allow it.
 */
export function CameraStep({
  instruction,
  guide,
  onPhoto,
  status,
}: {
  instruction: MessageKey;
  guide: GuideShape;
  onPhoto: (blob: Blob) => Promise<void>;
  /** Shown just above the shutter, such as GPS progress. */
  status?: React.ReactNode;
}) {
  const { t } = useT();
  const { videoRef, state, retry } = useCameraStream(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const take = async (make: () => Promise<Blob>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onPhoto(await make());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Instruction k={instruction} />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className={cx('h-full w-full object-cover', state !== 'live' && 'hidden')} playsInline muted />
        {state === 'live' && <FramingGuide shape={guide} />}
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <Spinner label={t('camera.starting')} />
          </div>
        )}
        {(state === 'blocked' || state === 'unavailable') && (
          <div className="absolute inset-0 overflow-y-auto bg-white p-4">
            {state === 'blocked' && (
              <>
                <p className="mb-3 text-[1.25rem] font-bold text-red-800">{t('camera.blocked')}</p>
                <PermissionHelp show={['denied']} />
                <button
                  type="button"
                  onClick={retry}
                  className="mt-4 flex min-h-[4rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-900 text-[1.125rem] font-semibold text-slate-900"
                >
                  <RotateCcw className="h-6 w-6" aria-hidden /> {t('common.tryAgain')}
                </button>
              </>
            )}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90">
            <Spinner label={t('camera.saving')} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
        {status}
        {failed && <p className="text-[1.125rem] font-bold text-red-800">{t('saved.failed')}</p>}
        {state === 'live' ? (
          <BigButton tone="go" icon={Camera} disabled={busy} onClick={() => void take(() => captureVideoFrame(videoRef.current!))} testId="shutter">
            {t('camera.take')}
          </BigButton>
        ) : state === 'starting' ? null : (
          <NativeCameraButton disabled={busy} onFile={(file) => void take(() => compressImageFile(file))} />
        )}
      </div>
    </div>
  );
}

/**
 * Scan the tag. A big "No tag" is always there. Reading is automatic; a known tag opens that record.
 */
export function TagStep({ onTag, onNoTag }: { onTag: (code: string) => void; onNoTag: () => void }) {
  const { t } = useT();
  const { videoRef, state } = useCameraStream(true);
  const [read, setRead] = useState<string | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (state !== 'live') return undefined;
    let stopped = false;
    const loop = async () => {
      while (!stopped && !done.current) {
        try {
          const video = videoRef.current;
          const text = video ? await scanVideoFrame(video) : null;
          if (text && !stopped && !done.current) {
            done.current = true;
            setRead(text);
            setTimeout(() => onTag(text), 400);
            return;
          }
        } catch {
          if (!stopped) setScanFailed(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }, [state, videoRef, onTag]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Instruction k="tag.title" />
      {/* Phase 19: printed barcodes on asset labels are read as well as QR codes. */}
      <p className="shrink-0 bg-slate-800 px-4 pb-2 text-[1.0625rem] font-semibold text-white" data-testid="tag-barcode-hint">
        <Say k="tag.barcodeHint" />
      </p>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className={cx('h-full w-full object-cover', state !== 'live' && 'hidden')} playsInline muted />
        {state === 'live' && <FramingGuide shape="square" />}
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <Spinner label={t('tag.loading')} />
          </div>
        )}
        {(state === 'blocked' || state === 'unavailable' || scanFailed) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white p-4 text-center text-[1.25rem] font-bold text-slate-900">
            {t('tag.failed')}
          </div>
        )}
        {read && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-emerald-50 text-[1.5rem] font-bold text-emerald-950">
            <CheckCircle2 className="h-20 w-20 text-emerald-800" aria-hidden />
            {t('tag.read')}
            <span className="max-w-full break-all px-4 font-mono text-[1.25rem]" data-testid="tag-read-code">
              {normalizeTag(read)}
            </span>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t-2 border-slate-900 bg-white p-3">
        <BigButton tone="primary" icon={Tag} onClick={onNoTag} disabled={!!read} testId="no-tag">
          {t('tag.none')}
        </BigButton>
      </div>
    </div>
  );
}
