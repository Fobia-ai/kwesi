import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PlayerProvider } from "../../../lib/playerStore";
import { MiniPlayer } from "../MiniPlayer";

describe("MiniPlayer", () => {
  it("renders no transport controls when no track is active, leaving no dead space", () => {
    render(
      <PlayerProvider>
        <MiniPlayer />
      </PlayerProvider>,
    );
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});
