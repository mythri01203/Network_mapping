import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, GraduationCap, X } from 'lucide-react';

import { isVoiceLanguage, WELCOME_LESSON } from '@fibergis/shared';

import { LANGUAGES } from '../../i18n/format';
import { LANGUAGE_NAMES, useFieldLanguage, useT } from '../../i18n/useT';
import { useLearnStore } from './learnStore';
import { VoiceGuidePlayer } from './VoiceGuidePlayer';
import { scriptOf } from './voiceLibrary';
import { WelcomePicture } from './WelcomePictures';

const BIG = 'flex min-h-[64px] flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-4 text-[18px] font-bold';

/** Three big language buttons, each in its own script. Remembered on this device. */
function LanguageChoice() {
  const lang = useFieldLanguage((s) => s.lang);
  const setLang = useFieldLanguage((s) => s.setLang);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Language">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          className={`min-h-[64px] rounded-2xl border-2 px-3 text-[20px] font-bold ${lang === code ? 'border-blue-900 bg-blue-800 text-white' : 'border-slate-400 bg-white text-slate-900'}`}
        >
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

/**
 * The welcome lesson (learning assistant, Stage 2): language, then five short steps with a
 * picture, the words and the voice. Shown once on a new device; afterwards from Help, "Learn
 * FiberGIS". It covers the screen on a phone and is a centred card on a computer. Nothing here
 * changes the network.
 */
export function WelcomeGuide() {
  const { t, lang } = useT();
  const { welcomeSeen, welcomeOpen, welcomeStep, openWelcome, closeWelcome, setWelcomeStep } = useLearnStore();
  const first = useRef<HTMLButtonElement>(null);

  // First open on this device: show it (silently; sound only starts with a tap).
  useEffect(() => {
    if (!useLearnStore.getState().welcomeSeen) openWelcome();
  }, [openWelcome]);

  const open = welcomeOpen || !welcomeSeen;
  const total = WELCOME_LESSON.length;
  // Step 0 is the language choice; 1..total are the lesson steps.
  const step = Math.min(Math.max(welcomeStep, 0), total);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWelcome();
      if (e.key === 'ArrowRight' && step < total) setWelcomeStep(step + 1);
      if (e.key === 'ArrowLeft' && step > 0) setWelcomeStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step, total, closeWelcome, setWelcomeStep]);

  if (!open) return null;

  const key = step > 0 ? WELCOME_LESSON[step - 1] : null;
  const script = key ? scriptOf(key) : undefined;
  const words = script && isVoiceLanguage(lang) ? script.text[lang] : undefined;

  return (
    <div className="fixed inset-0 z-[3000] flex items-stretch justify-center bg-slate-950/50 backdrop-blur-[2px] sm:items-center sm:p-6" data-testid="welcome-guide">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="animate-pop-in flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92vh] sm:max-w-2xl sm:rounded-3xl"
      >
        {/* On a phone the title has its own line under the icon and Skip, so it is not squeezed. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
          <span className="ui-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white" aria-hidden>
            <GraduationCap className="h-6 w-6" />
          </span>
          <h2 id="welcome-title" lang={lang} className="order-last min-w-0 basis-full text-[20px] font-bold leading-snug text-slate-900 sm:order-none sm:basis-auto sm:flex-1">
            {t('learn.welcomeTitle')}
          </h2>
          <button type="button" onClick={closeWelcome} data-testid="welcome-skip" className="ml-auto flex min-h-[48px] items-center gap-1.5 rounded-xl px-3 text-[16px] font-semibold text-slate-700 hover:bg-slate-100 sm:ml-0">
            <X className="h-5 w-5" aria-hidden />
            {t('learn.skip')}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" lang={lang}>
          {step === 0 ? (
            <>
              <WelcomePicture lessonKey="welcome.intro" />
              <h3 className="text-[20px] font-bold text-slate-900">{t('learn.chooseLanguage')}</h3>
              <LanguageChoice />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-slate-600" data-testid="welcome-step">
                  {t('learn.step', { n: step, total })}
                </span>
                <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">{t('learn.example')}</span>
              </div>
              <div className="flex gap-1" aria-hidden>
                {WELCOME_LESSON.map((k, i) => (
                  <span key={k} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-blue-600' : 'bg-slate-200'}`} />
                ))}
              </div>
              <div className="rounded-3xl bg-gradient-to-b from-slate-50 to-white p-3 ring-1 ring-slate-100">{key && <WelcomePicture lessonKey={key} />}</div>
              {key && <VoiceGuidePlayer lessonKey={key} />}
              <p className="text-[19px] leading-relaxed text-slate-900" data-testid="welcome-words">
                {words?.text}
              </p>
              {script?.terms && (
                <div className="flex flex-wrap gap-1.5" lang="en">
                  {script.terms.map((term) => (
                    <span key={term} className="rounded-lg bg-blue-50 px-2 py-1 text-[15px] font-bold text-blue-800 ring-1 ring-blue-100">
                      {term}
                    </span>
                  ))}
                </div>
              )}
              {words && !words.reviewed && <p className="text-[13px] text-slate-500">{t('learn.draftWords')}</p>}
            </>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 p-3 sm:p-4">
          {step > 0 && (
            <button type="button" onClick={() => setWelcomeStep(step - 1)} data-testid="welcome-back" className={`${BIG} border-slate-400 bg-white text-slate-900`}>
              <ArrowLeft className="h-6 w-6" aria-hidden />
              {t('learn.back')}
            </button>
          )}
          {step < total ? (
            <button ref={first} type="button" onClick={() => setWelcomeStep(step + 1)} data-testid="welcome-next" className={`${BIG} ui-brand border-blue-800 bg-blue-700 text-white`}>
              {step === 0 ? t('learn.start') : t('learn.next')}
              <ArrowRight className="h-6 w-6" aria-hidden />
            </button>
          ) : (
            <button ref={first} type="button" onClick={closeWelcome} data-testid="welcome-finish" className={`${BIG} border-emerald-900 bg-emerald-700 text-white`}>
              <Check className="h-6 w-6" aria-hidden />
              {t('learn.finish')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
