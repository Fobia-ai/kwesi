import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProvider, usePlayer, playerReducer, type PlayerState } from "../playerStore";

function Harness() {
  const player = usePlayer();
  return (
    <div>
      <span data-testid="status">{player.state.status}</span>
      <span data-testid="track">{player.state.track?.title ?? "none"}</span>
      <button
        onClick={() => player.play({ generationId: "g1", filePath: "/mock/generations/g1/output.wav", title: "Track 1" })}
      >
        play g1
      </button>
      <button onClick={() => player.togglePlayPause()}>toggle</button>
    </div>
  );
}

describe("playerReducer", () => {
  const base: PlayerState = { track: null, status: "idle", currentTime: 0, duration: 0, volume: 1, playbackRate: 1, queue: [], error: null };

  it("load_start sets loading state and resets time", () => {
    const track = { generationId: "g1", filePath: "/a.wav", title: "A" };
    const next = playerReducer(base, { type: "load_start", track });
    expect(next.status).toBe("loading");
    expect(next.track).toEqual(track);
    expect(next.currentTime).toBe(0);
  });

  it("time updates currentTime/duration without touching status", () => {
    const playing: PlayerState = { ...base, status: "playing" };
    const next = playerReducer(playing, { type: "time", currentTime: 5, duration: 20 });
    expect(next.currentTime).toBe(5);
    expect(next.duration).toBe(20);
    expect(next.status).toBe("playing");
  });

  it("ended resets to paused at time 0", () => {
    const playing: PlayerState = { ...base, status: "playing", currentTime: 12 };
    const next = playerReducer(playing, { type: "ended" });
    expect(next.status).toBe("paused");
    expect(next.currentTime).toBe(0);
  });

  it("load_error sets error state and message", () => {
    const next = playerReducer(base, { type: "load_error", error: "boom" });
    expect(next.status).toBe("error");
    expect(next.error).toBe("boom");
  });

  it("volume updates volume only", () => {
    const next = playerReducer(base, { type: "volume", volume: 0.4 });
    expect(next.volume).toBe(0.4);
    expect(next.status).toBe(base.status);
  });
});

describe("PlayerProvider", () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("starts idle with no track", () => {
    render(
      <PlayerProvider>
        <Harness />
      </PlayerProvider>,
    );
    expect(screen.getByTestId("track")).toHaveTextContent("none");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("loads and plays a track when play() is called", async () => {
    const user = userEvent.setup();
    render(
      <PlayerProvider>
        <Harness />
      </PlayerProvider>,
    );

    await user.click(screen.getByRole("button", { name: "play g1" }));

    await waitFor(() => expect(screen.getByTestId("track")).toHaveTextContent("Track 1"));
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("throws when usePlayer is called outside a PlayerProvider", () => {
    function Bad() {
      usePlayer();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/PlayerProvider/);
  });
});
