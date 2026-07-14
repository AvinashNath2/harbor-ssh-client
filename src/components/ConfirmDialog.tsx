interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="w-80 rounded-[14px] border border-border-raised bg-surface-pane p-5 shadow-xl">
        <p className="text-[14px] font-semibold text-text-primary">{title}</p>
        <p className="mt-2 text-[12.5px] text-text-secondary">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-input border border-border-input px-4 py-1.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-input bg-danger px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
