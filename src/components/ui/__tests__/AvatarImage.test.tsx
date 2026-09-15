import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AvatarImage } from "../AvatarImage";
import { kwesiArtistProfiles } from "../../../lib/artistProfiles";

vi.mock("../../../lib/artistProfiles", () => ({
  kwesiArtistProfiles: { readAvatar: vi.fn() },
}));

// jsdom doesn't implement the Blob URL APIs at all — stub both so the
// component's real code path (blob from bytes -> object URL -> <img src>)
// runs the same as it does in a real browser.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

describe("AvatarImage", () => {
  beforeEach(() => {
    vi.mocked(kwesiArtistProfiles.readAvatar).mockReset();
  });

  it("renders initials when there is no avatar path", () => {
    const { container } = render(<AvatarImage avatarPath={null} name="Midnight Muse" />);
    expect(screen.getByText("MM")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders a single-word name's first two letters as initials", () => {
    render(<AvatarImage avatarPath={null} name="Solo" />);
    expect(screen.getByText("SO")).toBeInTheDocument();
  });

  it("renders the real image once readAvatar resolves", async () => {
    vi.mocked(kwesiArtistProfiles.readAvatar).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    const { container } = render(<AvatarImage avatarPath="/avatars/a1.png" name="Midnight Muse" />);

    await waitFor(() => expect(container.querySelector("img")).toBeInTheDocument());
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:mock-url");
    expect(kwesiArtistProfiles.readAvatar).toHaveBeenCalledWith("/avatars/a1.png");
  });

  it("falls back to initials when readAvatar fails", async () => {
    vi.mocked(kwesiArtistProfiles.readAvatar).mockResolvedValue({ ok: false, reason: "not found" });
    const { container } = render(<AvatarImage avatarPath="/avatars/missing.png" name="Midnight Muse" />);

    await waitFor(() => expect(kwesiArtistProfiles.readAvatar).toHaveBeenCalled());
    expect(screen.getByText("MM")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
