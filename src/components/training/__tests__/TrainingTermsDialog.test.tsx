import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainingTermsDialog } from "../TrainingTermsDialog";

describe("TrainingTermsDialog", () => {
  it("says the user must own what they train on and is responsible for it", () => {
    render(<TrainingTermsDialog onAccept={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Train only on what's yours" })).toBeInTheDocument();
    expect(screen.getByText(/responsible for the material you train on/)).toBeInTheDocument();
  });

  it("keeps Accept disabled until the box is ticked", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<TrainingTermsDialog onAccept={onAccept} onCancel={vi.fn()} />);

    const accept = screen.getByRole("button", { name: "Accept and start" });
    expect(accept).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(accept).toBeEnabled();

    await user.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel from Cancel and from Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<TrainingTermsDialog onAccept={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
