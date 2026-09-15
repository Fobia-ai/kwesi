import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEscapeKey } from "../useEscapeKey";

function Harness({ onEscape }: { onEscape: () => void }) {
  useEscapeKey(onEscape);
  return <div>content</div>;
}

describe("useEscapeKey", () => {
  it("calls the handler when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);

    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler for other keys", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);

    await user.keyboard("{Enter}a");

    expect(onEscape).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    const { unmount } = render(<Harness onEscape={onEscape} />);

    unmount();
    await user.keyboard("{Escape}");

    expect(onEscape).not.toHaveBeenCalled();
  });
});
