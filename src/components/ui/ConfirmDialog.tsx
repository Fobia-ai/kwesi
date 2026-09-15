import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PillButton } from "./PillButton";
import { GlassPanel } from "./GlassPanel";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEscapeKey(onCancel);

  // Portaled to document.body — see Modal.tsx's comment: without this, a
  // backdrop-filter ancestor (any .kwesi-glass panel) traps this fixed
  // overlay inside itself instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <GlassPanel strong radius="panel" className="w-full max-w-sm p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-ink-muted">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onCancel}>
            Cancel
          </PillButton>
          <PillButton
            onClick={onConfirm}
            className={danger ? "!bg-red-600 !text-white hover:!brightness-110" : ""}
          >
            {confirmLabel}
          </PillButton>
        </div>
      </GlassPanel>
    </div>,
    document.body,
  );
}
