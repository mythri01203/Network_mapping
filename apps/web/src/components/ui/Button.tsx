import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive' | 'subtle' | 'dark';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'ui-brand bg-blue-600 text-white border border-blue-700/60 active:brightness-95 disabled:bg-blue-300 disabled:bg-none disabled:border-blue-300 disabled:shadow-none',
  secondary:
    'bg-white text-slate-700 border border-slate-200 shadow-xs hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 disabled:text-slate-400 disabled:bg-slate-50 disabled:shadow-none',
  ghost:
    'bg-transparent text-slate-600 border border-transparent hover:bg-slate-900/5 hover:text-slate-900 active:bg-slate-900/10 disabled:text-slate-300 disabled:bg-transparent',
  subtle:
    'bg-slate-100 text-slate-700 border border-transparent hover:bg-slate-200/80 hover:text-slate-900 disabled:text-slate-400',
  danger:
    'bg-white text-red-600 border border-red-200 shadow-xs hover:bg-red-50 hover:border-red-300 active:bg-red-100 disabled:text-red-300 disabled:shadow-none',
  destructive:
    'bg-red-600 text-white border border-red-700/60 shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-300 disabled:border-red-300 disabled:shadow-none',
  dark: 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm hover:bg-slate-700 hover:text-white disabled:text-slate-500',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-9 px-4 text-sm gap-2 rounded-md',
};

const ICON_SIZES: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 15, lg: 16 };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = ICON_SIZES[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,filter] duration-150 ease-out',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={2} className="shrink-0" />
      )}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={2} className="shrink-0" />}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'dark' | 'primary';
  active?: boolean;
  badge?: number | string | null;
}

const ICON_BTN_SIZES = {
  xs: { box: 'h-6 w-6 rounded', icon: 13 },
  sm: { box: 'h-7 w-7 rounded-md', icon: 15 },
  md: { box: 'h-8 w-8 rounded-md', icon: 16 },
  lg: { box: 'h-9 w-9 rounded-md', icon: 18 },
};

const ICON_BTN_VARIANTS = {
  ghost: {
    base: 'text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 border border-transparent',
    active: 'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 hover:text-blue-800',
  },
  secondary: {
    base: 'bg-white text-slate-600 border border-slate-200 shadow-xs hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
    active: 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs',
  },
  dark: {
    base: 'text-slate-400 hover:bg-white/10 hover:text-white border border-transparent',
    active: 'bg-white/10 text-white border border-white/10',
  },
  primary: {
    base: 'ui-brand bg-blue-600 text-white border border-blue-700/60',
    active: 'ui-brand bg-blue-700 text-white border border-blue-800/60',
  },
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', variant = 'ghost', active = false, badge, className, type = 'button', ...rest },
  ref,
) {
  const s = ICON_BTN_SIZES[size];
  const v = ICON_BTN_VARIANTS[variant];
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center transition-[background-color,border-color,color,box-shadow] duration-150 ease-out disabled:pointer-events-none disabled:opacity-40',
        s.box,
        active ? v.active : v.base,
        className,
      )}
      {...rest}
    >
      <Icon size={s.icon} strokeWidth={1.9} />
      {badge !== undefined && badge !== null && badge !== 0 && (
        <span
          className={cn(
            'absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2',
            variant === 'dark' ? 'ring-slate-900' : 'ring-white',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
});
