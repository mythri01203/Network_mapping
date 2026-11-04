import { AlertTriangle, HelpCircle } from 'lucide-react';

import { Button, Modal } from '../../components/ui';
import { useConfirmStore } from '../../stores/confirmStore';

/** Renders the pending confirmation request from `requestConfirm`. */
export function ConfirmDialogHost() {
  const pending = useConfirmStore((s) => s.pending);
  const respond = useConfirmStore((s) => s.respond);
  const danger = pending?.tone === 'danger';

  return (
    <Modal
      open={pending !== null}
      onClose={() => respond(false)}
      title={pending?.title ?? ''}
      icon={danger ? AlertTriangle : HelpCircle}
      size="sm"
      footer={
        <>
          <Button onClick={() => respond(false)}>{pending?.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={danger ? 'destructive' : 'primary'} onClick={() => respond(true)} data-autofocus>
            {pending?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{pending?.message}</p>
    </Modal>
  );
}
