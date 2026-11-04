import React, { useId } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

import { cn } from './cn';

const CONTROL_BASE =
  'w-full rounded-md border border-slate-300 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 transition-colors ' +
  'hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

const CONTROL_SIZES = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5',
  lg: 'h-9 px-3 text-sm',
};

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  controlSize?: keyof typeof CONTROL_SIZES;
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { controlSize = 'md', invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        CONTROL_BASE,
        CONTROL_SIZES[controlSize],
        invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  controlSize?: keyof typeof CONTROL_SIZES;
  invalid?: boolean;
  /** Classes for the positioning wrapper (defaults to full width). */
  wrapperClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { controlSize = 'md', invalid, className, wrapperClassName, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', wrapperClassName ?? 'w-full')}>
      <select
        ref={ref}
        className={cn(
          CONTROL_BASE,
          CONTROL_SIZES[controlSize],
          'appearance-none pr-8',
          invalid && 'border-red-400',
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL_BASE, 'px-2.5 py-1.5 leading-5', invalid && 'border-red-400', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement;
  inline?: boolean;
}

export function Field({ label, hint, error, required, className, children, inline }: FieldProps) {
  const autoId = useId();
  const id = (children.props as { id?: string }).id ?? autoId;
  const control = React.cloneElement(children, { id } as Record<string, unknown>);
  return (
    <div className={cn(inline ? 'flex items-center gap-3' : 'flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className={cn('text-xs font-medium text-slate-700', inline && 'w-32 shrink-0')}>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-slate-500">{hint}</p>
      )}
    </div>
  );
}

export interface SearchInputProps extends Omit<InputProps, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
}

export function SearchInput({
  value,
  onValueChange,
  className,
  placeholder = 'Search',
  controlSize = 'md',
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        controlSize={controlSize}
        className="pl-8 pr-7"
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, size = 'md', className }: SwitchProps) {
  const track = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
  const thumb = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const shift = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50',
        track,
        checked ? 'bg-blue-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow-sm transition-transform',
          thumb,
          checked ? shift : 'translate-x-0',
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{button}</span>;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-3',
        disabled && 'cursor-not-allowed',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      {button}
    </label>
  );
}

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700', className)}>
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-500"
        {...rest}
      />
      {label}
    </label>
  );
}
