import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

import { type Lang3D, type Msg3DKey, t3d } from '../i18n';
import { Btn } from './Panels';
import { panelClass, type Tone } from './style';

const STEPS = 5;

/** A five-step tour of the 3D view. Skippable at every step; shown once per device. */
export function OnboardingTour({ tone, lang, onClose }: { tone: Tone; lang: Lang3D; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const last = step === STEPS;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center p-4 md:items-center">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour3d-title"
        className={`pointer-events-auto w-full max-w-md p-4 ${panelClass(tone)}`}
      >
        <div className={`text-[11px] ${tone.dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {t3d(lang, 'tour.step', { n: step, total: STEPS })}
        </div>
        <h2 id="tour3d-title" ref={heading} tabIndex={-1} className="mt-1 text-[16px] font-semibold outline-none">
          {t3d(lang, `tour.${step}.t` as Msg3DKey)}
        </h2>
        <p className="mt-1 text-[13.5px] leading-snug">{t3d(lang, `tour.${step}.b` as Msg3DKey)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Btn tone={tone} onClick={onClose}>
            {t3d(lang, 'tour.skip')}
          </Btn>
          <div className="flex gap-2">
            {step > 1 && (
              <Btn tone={tone} onClick={() => setStep((s) => s - 1)}>
                {t3d(lang, 'tour.back')}
              </Btn>
            )}
            <Btn tone={tone} on onClick={() => (last ? onClose() : setStep((s) => s + 1))}>
              {last ? t3d(lang, 'tour.done') : t3d(lang, 'tour.next')}
            </Btn>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i + 1 <= step ? 'bg-emerald-500' : tone.dark ? 'bg-white/15' : 'bg-black/10'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function WebGLFallback({ lang, onBack }: { lang: Lang3D; onBack: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-slate-100 p-6">
      <div role="alert" className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow">
        <h2 className="text-[17px] font-semibold text-slate-900">{t3d(lang, 'noWebgl')}</h2>
        <p className="mt-2 text-[14px] text-slate-600">{t3d(lang, 'noWebglBody')}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 text-[14px] font-medium text-white hover:bg-blue-700"
        >
          <MapIcon size={16} /> {t3d(lang, 'back2d')}
        </button>
      </div>
    </div>
  );
}
