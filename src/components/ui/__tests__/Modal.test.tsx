import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../Modal";

describe("Modal", () => {
  it("renders its title and children", () => {
    render(
      <Modal title="New Workspace" onClose={vi.fn()}>
        <p>form goes here</p>
      </Modal>,
    );

    expect(screen.getByText("New Workspace")).toBeInTheDocument();
    expect(screen.getByText("form goes here")).toBeInTheDocument();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="New Workspace" onClose={onClose}>
        <p>form goes here</p>
      </Modal>,
    );

    // The backdrop is the outer fixed-inset div — click its text content's
    // ancestor via the title's grandparent, which is the backdrop itself.
    await user.click(screen.getByText("New Workspace").closest("div")!.parentElement!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the panel content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="New Workspace" onClose={onClose}>
        <p>form goes here</p>
      </Modal>,
    );

    await user.click(screen.getByText("form goes here"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="New Workspace" onClose={onClose}>
        <p>form goes here</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
