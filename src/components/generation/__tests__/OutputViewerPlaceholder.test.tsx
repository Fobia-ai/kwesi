import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutputViewerPlaceholder } from "../OutputViewerPlaceholder";

describe("OutputViewerPlaceholder", () => {
  it("shows a Stop button while running and calls onCancel when clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<OutputViewerPlaceholder outputKind="audio" status="running" progressPct={42} onCancel={onCancel} />);

    expect(screen.getByText("Generating… 42%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a Stop button while queued too", () => {
    const onCancel = vi.fn();
    render(<OutputViewerPlaceholder outputKind="audio" status="queued" onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("doesn't render a Stop button when no onCancel is given", () => {
    render(<OutputViewerPlaceholder outputKind="audio" status="running" progressPct={10} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("never shows Stop once the generation is done, failed, or cancelled", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<OutputViewerPlaceholder outputKind="audio" status="done" onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    rerender(<OutputViewerPlaceholder outputKind="audio" status="failed" error="boom" onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();

    rerender(<OutputViewerPlaceholder outputKind="audio" status="cancelled" onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
  });
});
