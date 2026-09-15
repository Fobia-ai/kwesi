import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassPanel } from "./GlassPanel";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEscapeKey(onClose);

  // Portaled to document.body: `position: fixed` is contained by any
  // ancestor with a `backdrop-filter` (the .kwesi-glass/.kwesi-glass-strong
  // classes used all over this app), which without a portal traps and
  // mis-sizes the overlay inside whatever glass panel happened to render it
  // rather than covering the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <GlassPanel
        strong
        radius="panel"
        className="w-full max-w-sm overflow-y-auto p-5"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">{title}</h2>
        {children}
      </GlassPanel>
    </div>,
    document.body,
  );
}
