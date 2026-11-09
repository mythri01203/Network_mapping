import type { ReactNode } from 'react';

/** Small labelled inputs for the Cable TV office forms. Blank means "not entered", never zero. */

export const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-500';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <div className="mt-0.5">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] font-normal text-slate-500">{hint}</div>}
    </label>
  );
}

export function TextField({ label, value, onChange, hint, testId, placeholder, inputMode }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  testId?: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  return (
    <Field label={label} hint={hint}>
      <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} placeholder={placeholder} inputMode={inputMode} aria-label={label} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, hint, testId }: {
  label: string;
  value: T | '';
  onChange: (v: T | '') => void;
  options: readonly { value: T | ''; label: string }[];
  hint?: string;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as T | '')} data-testid={testId} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SubmitButton({ children, onClick, testId, disabled }: { children: ReactNode; onClick: () => void; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40">
      {children}
    </button>
  );
}
