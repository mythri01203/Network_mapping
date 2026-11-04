import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from './cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  icon?: LucideIcon;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: 'underline' | 'segmented';
  size?: 'sm' | 'md';
  className?: string;
  fullWidth?: boolean;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
  fullWidth,
}: TabsProps<T>) {
  if (variant === 'segmented') {
    return (
      <div
        role="tablist"
        className={cn(
          'inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5',
          fullWidth && 'flex w-full',
          className,
        )}
      >
        {items.map((item) => {
          const active = item.id === value;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors disabled:opacity-40',
                size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs',
                fullWidth && 'flex-1',
                active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {Icon && <Icon size={size === 'sm' ? 12 : 13} strokeWidth={2} />}
              {item.label}
              {item.count !== undefined && (
                <span className={cn('tabular text-[10px]', active ? 'text-slate-500' : 'text-slate-400')}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-slate-200', className)}>
      {items.map((item) => {
        const active = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 font-medium transition-colors disabled:opacity-40',
              size === 'sm' ? 'h-8 text-xs' : 'h-9 text-[13px]',
              fullWidth && 'flex-1 justify-center',
              active
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            {Icon && <Icon size={14} strokeWidth={1.9} className={active ? 'text-blue-600' : undefined} />}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded px-1.5 text-[10px] font-semibold leading-4',
                  active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
