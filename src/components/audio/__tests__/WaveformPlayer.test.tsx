import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerProvider } from "../../../lib/playerStore";
import { WaveformPlayer } from "../WaveformPlayer";
import * as audioLib from "../../../lib/audio";

vi.mock("../../../lib/audio", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/audio")>("../../../lib/audio");
  return {
    ...actual,
    kwesiAudio: {
      stat: vi.fn(),
      read: vi.fn(),
      save: vi.fn(),
      reveal: vi.fn(),
    },
  };
});

function renderPlayer(props: Partial<ComponentProps<typeof WaveformPlayer>> = {}) {
  return render(
    <PlayerProvider>
      <WaveformPlayer generationId="g1" filePath="/gen/output.wav" title="Track 1" {...props} />
    </PlayerProvider>,
  );
}

describe("WaveformPlayer", () => {
  beforeEach(() => {
    vi.mocked(audioLib.kwesiAudio.stat).mockReset();
    vi.mocked(audioLib.kwesiAudio.read).mockReset();
  });

  it("shows an empty state for a zero-byte placeholder file", async () => {
    vi.mocked(audioLib.kwesiAudio.stat).mockResolvedValue({ exists: true, sizeBytes: 0 });
    renderPlayer();
    expect(await screen.findByText(/no audio yet/i)).toBeInTheDocument();
  });

  it("shows an empty state when the file is missing entirely", async () => {
    vi.mocked(audioLib.kwesiAudio.stat).mockResolvedValue({ exists: false, sizeBytes: 0 });
    renderPlayer();
    expect(await screen.findByText(/no audio yet/i)).toBeInTheDocument();
  });

  it("shows a real player for a non-empty file", async () => {
    vi.mocked(audioLib.kwesiAudio.stat).mockResolvedValue({ exists: true, sizeBytes: 128000 });
    renderPlayer();
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /seek/i })).toBeInTheDocument();
  });

  it("shows export/download/share actions only when expanded", async () => {
    vi.mocked(audioLib.kwesiAudio.stat).mockResolvedValue({ exists: true, sizeBytes: 128000 });
    renderPlayer({ compact: false });
    await screen.findByRole("button", { name: "Play" });
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("hides export/download/share actions in compact (library list) mode", async () => {
    vi.mocked(audioLib.kwesiAudio.stat).mockResolvedValue({ exists: true, sizeBytes: 128000 });
    renderPlayer({ compact: true });
    await screen.findByRole("button", { name: "Play" });
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
  });
});
