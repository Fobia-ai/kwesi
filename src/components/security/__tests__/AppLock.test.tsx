import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppLock } from "../AppLock";
import { kwesiSecurity } from "../../../lib/security";

vi.mock("../../../lib/security", () => ({
  kwesiSecurity: {
    hasPasscode: vi.fn(),
    getIdleTimeoutMinutes: vi.fn(),
    verifyPasscode: vi.fn(),
  },
}));

describe("AppLock", () => {
  beforeEach(() => {
    vi.mocked(kwesiSecurity.hasPasscode).mockReset();
    vi.mocked(kwesiSecurity.getIdleTimeoutMinutes).mockReset().mockResolvedValue(10);
    vi.mocked(kwesiSecurity.verifyPasscode).mockReset();
  });

  it("renders children without a lock screen when no passcode is set", async () => {
    vi.mocked(kwesiSecurity.hasPasscode).mockResolvedValue(false);
    render(
      <AppLock>
        <div>app content</div>
      </AppLock>,
    );

    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
    expect(screen.queryByText("Kwesi is locked")).not.toBeInTheDocument();
  });

  it("shows the lock screen on mount when a passcode is set", async () => {
    vi.mocked(kwesiSecurity.hasPasscode).mockResolvedValue(true);
    render(
      <AppLock>
        <div>app content</div>
      </AppLock>,
    );

    await waitFor(() => expect(screen.getByText("Kwesi is locked")).toBeInTheDocument());
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("unlocks and hides the lock screen after a correct passcode, keeping children mounted throughout", async () => {
    vi.mocked(kwesiSecurity.hasPasscode).mockResolvedValue(true);
    vi.mocked(kwesiSecurity.verifyPasscode).mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <AppLock>
        <div>app content</div>
      </AppLock>,
    );

    await waitFor(() => expect(screen.getByText("Kwesi is locked")).toBeInTheDocument());
    expect(screen.getByText("app content")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Passcode"), "1234");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(screen.queryByText("Kwesi is locked")).not.toBeInTheDocument());
    expect(screen.getByText("app content")).toBeInTheDocument();
  });
});
