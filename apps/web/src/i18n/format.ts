/**
 * A small ICU message formatter: `{name}`, `{n, plural, one {...} other {...}}` with `#`, and
 * `{x, select, a {...} other {...}}`. Whole sentences live in one message so translators can reorder
 * words; screens never join sentence pieces. Numbers always use Western digits.
 */

export type MessageValues = Record<string, string | number>;

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function formatNumber(value: number, locale: string): string {
  let format = numberFormats.get(locale);
  if (!format) {
    try {
      format = new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 });
    } catch {
      format = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
    }
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

function pluralCategory(value: number, locale: string): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(value);
}

/** Index of the brace that closes the one at `open`. */
function matchingBrace(pattern: string, open: number): number {
  let depth = 0;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === '{') depth += 1;
    else if (pattern[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses `one {...} other {...}` into a map of selector → branch text. */
function parseBranches(text: string): Map<string, string> {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const start = i;
    while (i < text.length && text[i] !== '{' && !/\s/.test(text[i])) i += 1;
    const selector = text.slice(start, i);
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    const end = matchingBrace(text, i);
    if (end < 0) break;
    branches.set(selector, text.slice(i + 1, end));
    i = end + 1;
  }
  return branches;
}

function formatArgument(body: string, values: MessageValues, locale: string): string {
  const firstComma = body.indexOf(',');
  const name = (firstComma < 0 ? body : body.slice(0, firstComma)).trim();
  const value = values[name];
  if (firstComma < 0) {
    if (value === undefined) return `{${name}}`;
    return typeof value === 'number' ? formatNumber(value, locale) : value;
  }
  const rest = body.slice(firstComma + 1);
  const secondComma = rest.indexOf(',');
  const kind = rest.slice(0, secondComma).trim();
  const branches = parseBranches(rest.slice(secondComma + 1));
  if (kind === 'plural') {
    const n = typeof value === 'number' ? value : Number(value);
    const branch = branches.get(`=${n}`) ?? branches.get(pluralCategory(n, locale)) ?? branches.get('other') ?? '';
    return formatMessage(branch, values, locale, Number.isFinite(n) ? formatNumber(n, locale) : '');
  }
  if (kind === 'select') {
    const branch = branches.get(String(value)) ?? branches.get('other') ?? '';
    return formatMessage(branch, values, locale);
  }
  return `{${name}}`;
}

/** Fills a message pattern. `hash` is what `#` means inside a plural branch. */
export function formatMessage(pattern: string, values: MessageValues = {}, locale = 'en', hash?: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '{') {
      const end = matchingBrace(pattern, i);
      if (end < 0) {
        out += pattern.slice(i);
        break;
      }
      out += formatArgument(pattern.slice(i + 1, end), values, locale);
      i = end + 1;
    } else if (ch === '#' && hash !== undefined) {
      out += hash;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export const LANGUAGES = ['en', 'te', 'kn'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface DraftText {
  text: string;
  /** False until a native speaker and field crews have checked it. Nothing on screen claims otherwise. */
  reviewed: boolean;
}

/** English is the source text. Telugu and Kannada are optional per key and fall back to English. */
export interface MessageEntry {
  en: string;
  te?: DraftText;
  kn?: DraftText;
}

export type Catalog = Record<string, MessageEntry>;

export interface Translation {
  text: string;
  /** The language actually used, which is English when the chosen one has no text for this key. */
  lang: Language;
}

/** Text for a key in a language, falling back to English, and to the key itself if even that is missing. */
export function translate(catalog: Catalog, lang: Language, key: string, values?: MessageValues): Translation {
  const entry = catalog[key];
  if (!entry) return { text: key, lang: 'en' };
  const local = lang === 'en' ? undefined : entry[lang];
  if (local?.text) return { text: formatMessage(local.text, values, lang), lang };
  return { text: formatMessage(entry.en, values, 'en'), lang: 'en' };
}

/** Keys whose Telugu or Kannada text still needs a native speaker and crew check. */
export function unreviewedKeys(catalog: Catalog, lang: Exclude<Language, 'en'>): string[] {
  return Object.entries(catalog)
    .filter(([, entry]) => entry[lang] && !entry[lang]?.reviewed)
    .map(([key]) => key);
}

/** Keys with no text at all in a language, which show in English. */
export function missingKeys(catalog: Catalog, lang: Exclude<Language, 'en'>): string[] {
  return Object.entries(catalog)
    .filter(([, entry]) => !entry[lang]?.text)
    .map(([key]) => key);
}
