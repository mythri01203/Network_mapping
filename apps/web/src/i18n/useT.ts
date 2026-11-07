import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { preferenceKey, preferenceStorage } from '../stores/persistStorage';
import { type Language, LANGUAGES, type MessageValues, translate, type Translation } from './format';
import { type MessageKey, MESSAGES } from './messages';

interface FieldLanguageState {
  lang: Language;
  /** The worker has picked a language on this phone. */
  chosen: boolean;
  /** The first-run picture help has been shown on this phone. */
  helpSeen: boolean;
  setLang: (lang: Language) => void;
  setHelpSeen: (seen: boolean) => void;
}

/** The capture flow's language, remembered per device. Engineer screens stay in English. */
export const useFieldLanguage = create<FieldLanguageState>()(
  persist(
    (set) => ({
      lang: 'en',
      chosen: false,
      helpSeen: false,
      setLang: (lang) => set({ lang: LANGUAGES.includes(lang) ? lang : 'en', chosen: true }),
      setHelpSeen: (helpSeen) => set({ helpSeen }),
    }),
    {
      name: preferenceKey('field_language'),
      storage: preferenceStorage,
      partialize: ({ lang, chosen, helpSeen }) => ({ lang, chosen, helpSeen }),
    },
  ),
);

export type TFunction = (key: MessageKey, values?: MessageValues) => string;

/** `t(key)` for the current field language, falling back to English per key. */
export function useT(): { t: TFunction; tr: (key: MessageKey, values?: MessageValues) => Translation; lang: Language } {
  const lang = useFieldLanguage((s) => s.lang);
  const tr = useCallback((key: MessageKey, values?: MessageValues) => translate(MESSAGES, lang, key, values), [lang]);
  const t = useCallback<TFunction>((key, values) => tr(key, values).text, [tr]);
  return { t, tr, lang };
}

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', te: 'తెలుగు', kn: 'ಕನ್ನಡ' };
