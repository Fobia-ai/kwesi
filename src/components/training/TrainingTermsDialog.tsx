import { useState } from "react";
import { createPortal } from "react-dom";
import { PillButton } from "../ui/PillButton";
import { GlassPanel } from "../ui/GlassPanel";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface TrainingTermsDialogProps {
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * Shown once, before the first training run: a model is trained on whatever
 * the user drops in, so the user confirms it is theirs to use and that they
 * are responsible for it. The run only starts once the box is ticked and
 * accepted; acceptance is stored (kwesiSettings.acceptTrainingTerms) so it is
 * never asked again.
 */
export function TrainingTermsDialog({ onAccept, onCancel }: TrainingTermsDialogProps) {
  const [agreed, setAgreed] = useState(false);
  useEscapeKey(onCancel);

  // Portaled to document.body — see Modal.tsx's comment: without this, a
  // backdrop-filter ancestor (any .kwesi-glass panel) traps this fixed
  // overlay inside itself instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <GlassPanel
        strong
        radius="panel"
        className="w-full max-w-md p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="training-terms-title"
      >
        <h2 id="training-terms-title" className="text-base font-semibold">
          Train only on what's yours
        </h2>
        <div className="mt-2 flex flex-col gap-2.5 text-sm text-ink-muted">
          <p>
            A model learns from the files you give it. Only train on audio, MIDI, lyrics and captions that you made
            yourself, or that you have permission to use.
          </p>
          <p>
            You are responsible for the material you train on, and for any copyright infringement that comes from it,
            including in what your trained model makes. Kwesi does not check who owns your files, and Fobia is not liable
            for how you use them.
          </p>
          <label className="mt-1 flex items-start gap-2 text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            I own or have the rights to everything I train on, and I accept responsibility for it.
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onCancel}>
            Cancel
          </PillButton>
          <PillButton onClick={onAccept} disabled={!agreed}>
            Accept and start
          </PillButton>
        </div>
      </GlassPanel>
    </div>,
    document.body,
  );
}
