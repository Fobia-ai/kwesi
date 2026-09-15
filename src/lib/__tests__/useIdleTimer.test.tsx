import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useIdleTimer } from "../useIdleTimer";

function Harness({
  timeoutMinutes,
  enabled,
  onIdle,
}: {
  timeoutMinutes: number;
  enabled: boolean;
  onIdle: () => void;
}) {
  useIdleTimer(timeoutMinutes, enabled, onIdle);
  return <div>content</div>;
}

describe("useIdleTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onIdle after the timeout elapses", () => {
    const onIdle = vi.fn();
    render(<Harness timeoutMinutes={5} enabled={true} onIdle={onIdle} />);

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not start a timer when disabled", () => {
    const onIdle = vi.fn();
    render(<Harness timeoutMinutes={5} enabled={false} onIdle={onIdle} />);

    vi.advanceTimersByTime(10 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not start a timer when timeoutMinutes is 0", () => {
    const onIdle = vi.fn();
    render(<Harness timeoutMinutes={0} enabled={true} onIdle={onIdle} />);

    vi.advanceTimersByTime(60 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("resets the timer on activity", () => {
    const onIdle = vi.fn();
    render(<Harness timeoutMinutes={5} enabled={true} onIdle={onIdle} />);

    vi.advanceTimersByTime(4 * 60_000);
    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(4 * 60_000);

    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("clears its timer on unmount", () => {
    const onIdle = vi.fn();
    const { unmount } = render(<Harness timeoutMinutes={5} enabled={true} onIdle={onIdle} />);

    unmount();
    vi.advanceTimersByTime(10 * 60_000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
