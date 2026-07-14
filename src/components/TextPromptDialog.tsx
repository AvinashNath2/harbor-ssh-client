import { useState } from "react";

interface TextPromptDialogProps {
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function TextPromptDialog({
  title,
  placeholder,
  initialValue = "",
  confirmLabel = "Create",
  onConfirm,
  onCancel,
}: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (value.trim()) onConfirm(value.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <form
        onSubmit={handleSubmit}
        className="w-72 rounded-[14px] border border-border-raised bg-surface-pane p-5 shadow-xl"
      >
        <p className="mb-3 text-[13.5px] font-semibold text-text-primary">{title}</p>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="w-full rounded-input border border-border-input bg-transparent px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-input border border-border-input px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-input bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
