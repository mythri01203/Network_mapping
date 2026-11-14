import { LANGUAGES } from '../../i18n/format';
import { LANGUAGE_NAMES, useFieldLanguage, useT } from '../../i18n/useT';

/**
 * Language buttons shown right beside an explanation, each name in its own script, so the person
 * picks the language at the moment they want to hear or read it. Remembered on this device.
 */
export function LanguagePicker({ small = false }: { small?: boolean }) {
  const { t } = useT();
  const lang = useFieldLanguage((s) => s.lang);
  const setLang = useFieldLanguage((s) => s.setLang);
  return (
    <div className="flex gap-1.5" role="group" aria-label={t('learn.chooseLanguage')} data-testid="learn-language">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          className={`flex-1 rounded-xl border-2 px-2 font-bold ${small ? 'min-h-[40px] text-[14px]' : 'min-h-[48px] text-[16px]'} ${lang === code ? 'border-blue-900 bg-blue-800 text-white' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'}`}
        >
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
