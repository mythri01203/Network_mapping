import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type LucideIcon, X } from 'lucide-react';

import { cn } from './cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'w-full max-w-md max-h-[85vh]',
  md: 'w-full max-w-lg max-h-[85vh]',
  lg: 'w-full max-w-2xl max-h-[88vh]',
  xl: 'w-full max-w-4xl max-h-[90vh]',
  '2xl': 'w-full max-w-6xl max-h-[92vh]',
  full: 'w-[calc(100vw-48px)] h-[calc(100vh-48px)]',
};

// Only the top-most open modal should react to Escape.
const modalStack: string[] = [];

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  size?: ModalSize;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  closeOnOverlayClick?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  size = 'lg',
  footer,
  headerActions,
  children,
  bodyClassName,
  className,
  closeOnOverlayClick = true,
}: ModalProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        const autofocus = panel.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
        (autofocus ?? panel).focus({ preventScroll: true });
      }
    });
    return () => {
      window.removeEventListener('keydown', handleKey);
      const idx = modalStack.lastIndexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, id]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-fade-in pointer-events-none absolute inset-0 bg-slate-900/40" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className={cn(
          'animate-pop-in relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-overlay)] outline-none',
          SIZE_CLASSES[size],
          className,
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-5 py-3.5">
          {Icon && (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
              <Icon size={16} strokeWidth={1.9} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="truncate text-[15px] font-semibold leading-6 text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
          {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close (Esc)"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} />
          </button>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
