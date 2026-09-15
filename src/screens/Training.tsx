import { EmptyState } from "../components/ui/EmptyState";
import { TrainingIcon } from "../components/ui/icons";

export function TrainingScreen() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Training</h1>
        <p className="text-sm text-ink-muted">
          Drop in your own music, fine-tune a base model, choose where the checkpoint is saved.
          Lands in Phases 10–11 — see kwesi.docs/04-roadmap.md.
        </p>
      </div>
      <EmptyState
        icon={<TrainingIcon width={28} height={28} />}
        title="No training runs yet. RAVE is the planned pilot model for this pipeline."
      />
    </div>
  );
}
