import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, Eye, EyeOff, Loader2, LogIn, type LucideIcon, Network, ShieldCheck, UserRound, Wrench } from 'lucide-react';

import type { AccountRole } from '@fibergis/shared';

import { LANGUAGES } from '../../i18n/format';
import { LANGUAGE_NAMES, useFieldLanguage, useT } from '../../i18n/useT';
import { type RememberedPerson, useAuthStore } from '../../stores/authStore';
import { useSyncStore } from '../../stores/syncStore';
import { FirstAdminForm } from '../admin/UsersPanel';

/**
 * The login screen (Phase 9), built to `fibergis-easy-field-ux`: one question per screen, big
 * targets (64 to 72 px), a picture with every choice, people who used this phone before as big
 * tiles so most logins need no typing of a name, errors as next actions. Telugu and Kannada words
 * are unreviewed drafts, like the rest of the field screens.
 */

const ROLE_PICTURE: Record<AccountRole, LucideIcon> = {
  admin: ShieldCheck,
  engineer: Network,
  office: Building2,
  technician: Wrench,
  viewer: Eye,
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

const BIG = 'flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl border-2 px-4 py-3 text-[1.25rem] font-bold leading-tight disabled:opacity-50';
const INPUT = 'min-h-[4rem] w-full rounded-2xl border-2 border-slate-900 bg-white px-4 text-[1.375rem] font-semibold text-slate-900 outline-none focus:border-blue-700';

export function LanguageRow() {
  const lang = useFieldLanguage((s) => s.lang);
  const setLang = useFieldLanguage((s) => s.setLang);
  return (
    <div className="flex gap-2" role="group" aria-label="Language">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          onClick={() => setLang(code)}
          className={`min-h-12 flex-1 rounded-xl border-2 px-2 text-base font-semibold ${lang === code ? 'border-blue-900 bg-blue-800 text-white' : 'border-slate-400 bg-white text-slate-900'}`}
        >
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

function PersonTile({ person, onPick }: { person: RememberedPerson; onPick: () => void }) {
  const Picture = ROLE_PICTURE[person.role];
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={`login-person-${person.username}`}
      className="flex min-h-[5rem] w-full items-center gap-4 rounded-2xl border-2 border-slate-900 bg-white px-4 py-3 text-left"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-800 text-xl font-bold text-white" aria-hidden>
        {initials(person.displayName) || <UserRound className="h-8 w-8" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.25rem] font-bold text-slate-900">{person.displayName}</span>
        <span className="block truncate text-base text-slate-600">{person.username}</span>
      </span>
      <Picture className="h-8 w-8 shrink-0 text-slate-700" aria-hidden />
    </button>
  );
}

export function LoginScreen() {
  const { t } = useT();
  const people = useAuthStore((s) => s.people);
  const login = useAuthStore((s) => s.login);
  const pending = useSyncStore((s) => s.pendingCount);
  const setupPending = useAuthStore((s) => s.setupPending);
  const setupCodeAccepted = useAuthStore((s) => s.setupCodeAccepted);
  const [step, setStep] = useState<'who' | 'name' | 'password'>(people.length > 0 ? 'who' : 'name');
  const [username, setUsername] = useState('');
  const [chosen, setChosen] = useState<RememberedPerson | null>(null);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, [step]);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const problem = await login(chosen?.username ?? username, password);
    setBusy(false);
    if (problem) {
      setError(problem);
      setPassword('');
    }
  };

  return (
    <main data-testid="login-screen" className="flex min-h-screen w-full justify-center overflow-y-auto bg-slate-100 font-sans" style={{ fontSize: '1rem' }}>
      <div className="flex w-full max-w-md flex-col gap-4 px-4 py-6">
        <LanguageRow />
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-800 text-white" aria-hidden>
            <LogIn className="h-8 w-8" />
          </span>
          <h1 className="text-[1.75rem] font-bold text-slate-900">{t('login.title')}</h1>
        </div>
        {pending > 0 && (
          <p data-testid="login-kept" className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3 text-[1.125rem] font-semibold text-emerald-900">
            {t('login.kept', { count: pending })}
          </p>
        )}
        {setupPending && (
          <p role="status" data-testid="login-not-set-up" className="rounded-2xl border-2 border-amber-800 bg-amber-50 p-3 text-[1.125rem] font-semibold text-amber-950">
            {t('login.notSetUp')}
          </p>
        )}
        {setupPending && setupCodeAccepted && <FirstAdminForm />}

        {step === 'who' && (
          <>
            <h2 className="text-[1.375rem] font-bold text-slate-900">{t('login.whoAreYou')}</h2>
            {people.map((person) => (
              <PersonTile
                key={person.username}
                person={person}
                onPick={() => {
                  setChosen(person);
                  setStep('password');
                }}
              />
            ))}
            <button
              type="button"
              data-testid="login-someone-else"
              onClick={() => {
                setChosen(null);
                setStep('name');
              }}
              className={`${BIG} border-slate-900 bg-white text-slate-900`}
            >
              <UserRound className="h-8 w-8" aria-hidden />
              {t('login.someoneElse')}
            </button>
          </>
        )}

        {step === 'name' && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim()) setStep('password');
            }}
          >
            <label className="text-[1.375rem] font-bold text-slate-900" htmlFor="login-name">
              {t('login.name')}
            </label>
            <input
              id="login-name"
              ref={field}
              data-testid="login-name"
              className={INPUT}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              spellCheck={false}
            />
            <button type="submit" disabled={!username.trim()} data-testid="login-next" className={`${BIG} border-blue-900 bg-blue-800 text-white`}>
              {t('login.next')}
            </button>
            {people.length > 0 && (
              <button type="button" onClick={() => setStep('who')} className={`${BIG} border-slate-900 bg-white text-slate-900`}>
                <ArrowLeft className="h-7 w-7" aria-hidden />
                {t('login.back')}
              </button>
            )}
          </form>
        )}

        {step === 'password' && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="flex items-center gap-3 text-[1.25rem] font-bold text-slate-900">
              <UserRound className="h-8 w-8 shrink-0" aria-hidden />
              <span className="truncate">{chosen?.displayName ?? username}</span>
            </p>
            {/* Lets the password manager pair the password with the name. */}
            <input type="text" className="hidden" autoComplete="username" readOnly value={chosen?.username ?? username} tabIndex={-1} aria-hidden />
            <label className="text-[1.375rem] font-bold text-slate-900" htmlFor="login-password">
              {t('login.password')}
            </label>
            <div className="flex gap-2">
              <input
                id="login-password"
                ref={field}
                data-testid="login-password"
                className={INPUT}
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? t('login.hide') : t('login.show')}
                className="flex min-h-[4rem] min-w-[4rem] flex-col items-center justify-center rounded-2xl border-2 border-slate-900 bg-white text-sm font-semibold text-slate-900"
              >
                {show ? <EyeOff className="h-7 w-7" aria-hidden /> : <Eye className="h-7 w-7" aria-hidden />}
                {show ? t('login.hide') : t('login.show')}
              </button>
            </div>
            {error && (
              <p role="alert" data-testid="login-error" className="rounded-2xl border-2 border-red-800 bg-red-50 p-3 text-[1.125rem] font-semibold text-red-900">
                {error}
              </p>
            )}
            <button type="submit" disabled={!password || busy} data-testid="login-go" className={`${BIG} border-emerald-900 bg-emerald-800 text-white`}>
              {busy ? <Loader2 className="h-8 w-8 animate-spin" aria-hidden /> : <LogIn className="h-8 w-8" aria-hidden />}
              {busy ? t('login.checking') : t('login.go')}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPassword('');
                setStep(people.length > 0 ? 'who' : 'name');
              }}
              className={`${BIG} border-slate-900 bg-white text-slate-900`}
            >
              <ArrowLeft className="h-7 w-7" aria-hidden />
              {t('login.back')}
            </button>
            <p className="text-[1.0625rem] text-slate-700">{t('login.forgot')}</p>
          </form>
        )}
      </div>
    </main>
  );
}

/** "Choose your own password": after the office set a temporary one, or from the user menu. */
export function PasswordScreen({ required }: { required: boolean }) {
  const { t } = useT();
  const min = useAuthStore((s) => s.passwordMinLength);
  const change = useAuthStore((s) => s.changePassword);
  const close = useAuthStore((s) => s.setPasswordChangeOpen);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const problem = await change(current, next);
    setBusy(false);
    if (problem) setError(problem);
    else close(false);
  };

  return (
    <main data-testid="password-screen" className="fixed inset-0 z-[3000] flex justify-center overflow-y-auto bg-slate-100 font-sans">
      <form
        className="flex w-full max-w-md flex-col gap-4 px-4 py-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (next.length >= min && current) void save();
        }}
      >
        <h1 className="text-[1.75rem] font-bold text-slate-900">{t('login.newPassword')}</h1>
        <label className="text-[1.25rem] font-bold text-slate-900" htmlFor="pw-current">
          {t('login.oldPassword')}
        </label>
        <input id="pw-current" data-testid="pw-current" className={INPUT} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <label className="text-[1.25rem] font-bold text-slate-900" htmlFor="pw-next">
          {t('login.newPassword')}
        </label>
        <input id="pw-next" data-testid="pw-next" className={INPUT} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <p className="text-[1.0625rem] text-slate-700">{t('login.minLength', { count: min })}</p>
        {error && (
          <p role="alert" className="rounded-2xl border-2 border-red-800 bg-red-50 p-3 text-[1.125rem] font-semibold text-red-900">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || next.length < min || !current} data-testid="pw-save" className={`${BIG} border-emerald-900 bg-emerald-800 text-white`}>
          {t('login.savePassword')}
        </button>
        {!required && (
          <button type="button" onClick={() => close(false)} className={`${BIG} border-slate-900 bg-white text-slate-900`}>
            {t('login.later')}
          </button>
        )}
      </form>
    </main>
  );
}
