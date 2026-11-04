import React, { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'start' | 'end';
  side?: 'bottom' | 'top' | 'right';
  className?: string;
  panelClassName?: string;
}

/** Click-to-open floating panel that closes on outside click and Escape. */
export function Popover({ trigger, children, align = 'end', side = 'bottom', className, panelClassName }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const position =
    side === 'right'
      ? 'left-full top-0 ml-2'
      : cn(side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5', align === 'end' ? 'right-0' : 'left-0');

  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            'animate-pop-in absolute z-[1500] min-w-48 rounded-lg border border-slate-200 bg-white py-1 text-slate-700 shadow-[var(--shadow-overlay)]',
            position,
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export interface MenuItemProps {
  icon?: LucideIcon;
  label: React.ReactNode;
  hint?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function MenuItem({ icon: Icon, label, hint, onClick, active, danger, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        active && 'font-medium text-blue-700',
      )}
    >
      {Icon && <Icon size={15} strokeWidth={1.9} className={cn('shrink-0', danger ? 'text-red-500' : active ? 'text-blue-600' : 'text-slate-400')} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-slate-400">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-slate-100" />;
}
