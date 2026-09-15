import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LockScreen } from "../LockScreen";
import { kwesiSecurity } from "../../../lib/security";

vi.mock("../../../lib/security", () => ({
  kwesiSecurity: { verifyPasscode: vi.fn() },
}));

describe("LockScreen", () => {
  beforeEach(() => {
    vi.mocked(kwesiSecurity.verifyPasscode).mockReset();
  });

  it("calls onUnlocked when the passcode is correct", async () => {
    vi.mocked(kwesiSecurity.verifyPasscode).mockResolvedValue(true);
    const user = userEvent.setup();
    const onUnlocked = vi.fn();
    render(<LockScreen onUnlocked={onUnlocked} />);

    await user.type(screen.getByPlaceholderText("Passcode"), "1234");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(kwesiSecurity.verifyPasscode).toHaveBeenCalledWith("1234");
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("shows an error and does not unlock when the passcode is wrong", async () => {
    vi.mocked(kwesiSecurity.verifyPasscode).mockResolvedValue(false);
    const user = userEvent.setup();
    const onUnlocked = vi.fn();
    render(<LockScreen onUnlocked={onUnlocked} />);

    await user.type(screen.getByPlaceholderText("Passcode"), "wrong");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That passcode isn't right.");
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("disables the unlock button until a passcode is entered", () => {
    render(<LockScreen onUnlocked={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
  });
});
