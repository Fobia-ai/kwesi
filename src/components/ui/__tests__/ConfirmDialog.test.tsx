import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title, description, and default confirm label", () => {
    render(
      <ConfirmDialog
        title='Delete "Chill Beats"?'
        description="This removes the workspace."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Delete "Chill Beats"?')).toBeInTheDocument();
    expect(screen.getByText("This removes the workspace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("uses a custom confirm label when given", () => {
    render(
      <ConfirmDialog
        title="Remove model?"
        description="..."
        confirmLabel="Remove"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="t" description="d" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="t" description="d" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="t" description="d" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("supports an interactive checkbox passed as the description", async () => {
    const user = userEvent.setup();
    function Wrapper() {
      const [checked, setChecked] = useState(false);
      return (
        <ConfirmDialog
          title="t"
          description={
            <label>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              Also delete the files on disk
            </label>
          }
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
    }
    render(<Wrapper />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
