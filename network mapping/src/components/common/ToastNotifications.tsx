import React from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X
} from 'lucide-react';

export const ToastNotifications: React.FC = () => {
  const { toasts, removeToast } = useNetwork();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[2000] flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      {toasts.map(toast => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3.5 rounded-2xl shadow-2xl border backdrop-blur-md flex items-start gap-3 animate-in fade-in slide-in-from-bottom-3 transition-all ${
              isSuccess
                ? 'bg-slate-900/95 text-white border-emerald-500/50'
                : isError
                ? 'bg-rose-950/95 text-white border-rose-500/50'
                : isWarning
                ? 'bg-amber-950/95 text-white border-amber-500/50'
                : 'bg-slate-900/95 text-white border-slate-700/80'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {isError && <AlertCircle className="w-4 h-4 text-rose-400" />}
              {isWarning && <AlertTriangle className="w-4 h-4 text-amber-400" />}
              {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
            </div>

            <div className="flex-1">
              <div className="font-bold text-xs leading-tight mb-0.5">{toast.title}</div>
              <div className="text-[11px] text-slate-300 leading-normal">{toast.message}</div>
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-white shrink-0 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
