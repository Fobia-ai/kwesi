import type { ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEscapeKey(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <GlassPanel
        strong
        radius="panel"
        className="w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">{title}</h2>
        {children}
      </GlassPanel>
    </div>
  );
}
