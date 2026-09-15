import { useState, type FormEvent } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PillButton } from "../ui/PillButton";
import { LockIcon } from "../ui/icons";
import { kwesiSecurity } from "../../lib/security";

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passcode) return;
    setChecking(true);
    setError(null);
    try {
      const ok = await kwesiSecurity.verifyPasscode(passcode);
      if (ok) {
        setPasscode("");
        onUnlocked();
      } else {
        setError("That passcode isn't right.");
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="kwesi-glass fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-2xl">
      <div className="kwesi-backdrop" />
      <GlassPanel strong radius="panel" className="relative z-10 flex w-full max-w-xs flex-col items-center gap-4 p-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent">
          <LockIcon width={20} height={20} />
        </div>
        <div>
          <h1 className="text-base font-semibold">Kwesi is locked</h1>
          <p className="mt-1 text-xs text-ink-muted">Enter your passcode to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2.5">
          <input
            autoFocus
            type="password"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setError(null);
            }}
            placeholder="Passcode"
            className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-center text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <PillButton type="submit" disabled={!passcode || checking} className="w-full">
            {checking ? "Checking…" : "Unlock"}
          </PillButton>
        </form>
      </GlassPanel>
    </div>
  );
}
