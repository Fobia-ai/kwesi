import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideOver } from "../SlideOver";

describe("SlideOver", () => {
  it("renders its title, optional subtitle, and children", () => {
    render(
      <SlideOver title="New Generation" subtitle="ACE-Step 1.5" onClose={vi.fn()}>
        <p>form goes here</p>
      </SlideOver>,
    );

    expect(screen.getByText("New Generation")).toBeInTheDocument();
    expect(screen.getByText("ACE-Step 1.5")).toBeInTheDocument();
    expect(screen.getByText("form goes here")).toBeInTheDocument();
  });

  it("omits the subtitle when none is given", () => {
    render(
      <SlideOver title="New Generation" onClose={vi.fn()}>
        <p>form goes here</p>
      </SlideOver>,
    );

    expect(screen.queryByText("ACE-Step 1.5")).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver title="New Generation" onClose={onClose}>
        <p>form goes here</p>
      </SlideOver>,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver title="New Generation" onClose={onClose}>
        <p>form goes here</p>
      </SlideOver>,
    );

    // header row -> panel -> backdrop
    const closeButton = screen.getByRole("button", { name: "Close" });
    const backdrop = closeButton.parentElement!.parentElement!.parentElement!;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the panel content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver title="New Generation" onClose={onClose}>
        <p>form goes here</p>
      </SlideOver>,
    );

    await user.click(screen.getByText("form goes here"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver title="New Generation" onClose={onClose}>
        <p>form goes here</p>
      </SlideOver>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
