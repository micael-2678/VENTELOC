import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Boîte de confirmation avec conséquences expliquées (remplace les confirm() natifs) ; `children` : champs
// supplémentaires (motif, choix). `onConfirm` renvoie une promesse ; une erreur laisse la boîte ouverte.
const ConfirmDialog = ({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  tone = 'navy',
  disabled = false,
  onConfirm,
  children,
  testId,
}) => {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose?.();
    } catch (e) {
      // le message est affiché par l'appelant (toast) ; la boîte reste ouverte
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose?.(); }}>
      <DialogContent className="max-w-lg rounded-2xl w-[calc(100%-1.5rem)]" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-brand-navy">{title}</DialogTitle>
          {description && <DialogDescription className="text-sm text-gray-700 leading-relaxed">{description}</DialogDescription>}
        </DialogHeader>
        {children && <div className="space-y-3">{children}</div>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-xl">{cancelLabel}</Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={busy || disabled}
            className={cn('rounded-xl text-white', tone === 'danger' ? 'bg-red-700 hover:bg-red-800' : tone === 'green' ? 'bg-brand-green hover:bg-brand-green-dark' : 'bg-brand-navy hover:bg-brand-navy-light')}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmDialog;
