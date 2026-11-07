import React from 'react';
import { CircleCheck, CircleX, Info, type LucideIcon, TriangleAlert, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '../../components/ui';
import { useToastStore } from '../../stores/toastStore';

const TONES: Record<string, { icon: LucideIcon; iconClass: string; bar: string }> = {
  success: { icon: CircleCheck, iconClass: 'text-emerald-600', bar: 'bg-emerald-500' },
  error: { icon: CircleX, iconClass: 'text-red-600', bar: 'bg-red-500' },
  warning: { icon: TriangleAlert, iconClass: 'text-amber-600', bar: 'bg-amber-500' },
  info: { icon: Info, iconClass: 'text-blue-600', bar: 'bg-blue-500' },
};

/** Taps pass through a toast card, so a message never blocks the button under it. */
export const ToastNotifications: React.FC = () => {
  const { toasts, removeToast } = useToastStore(useShallow((s) => ({ toasts: s.toasts, removeToast: s.dismiss })));

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="toast-stack pointer-events-none fixed inset-x-2 top-14 z-[2100] flex flex-col gap-2 xl:inset-x-auto xl:bottom-4 xl:right-4 xl:top-auto xl:w-[360px] xl:max-w-[calc(100vw-2rem)]"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.type] || TONES.info;
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className="animate-slide-in-right relative flex gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white py-3 pl-4 pr-3 shadow-[var(--shadow-overlay)]"
          >
            <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.bar)} />
            <Icon size={18} strokeWidth={2} className={cn('mt-px shrink-0', tone.iconClass)} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-5 text-slate-900">{toast.title}</p>
              {toast.message && <p className="mt-0.5 text-[12.5px] leading-[18px] text-slate-600">{toast.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="pointer-events-auto -mr-1 -mt-1 hidden h-6 w-6 shrink-0 rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 xl:block"
              aria-label="Dismiss notification"
            >
              <X size={14} className="mx-auto" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
