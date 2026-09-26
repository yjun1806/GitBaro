// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BUSY_TIMING, useSteadyFlag, useSteadyValue } from "../useSteadyValue";

const timing = { showAfterMs: 300, holdMs: 800 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSteadyValue", () => {
  it("hides work that ends before showAfterMs", () => {
    const { result, rerender } = renderHook(({ v }) => useSteadyValue<string>(v, timing), {
      initialProps: { v: "fetch" as string | null },
    });
    act(() => void vi.advanceTimersByTime(timing.showAfterMs - 1));
    expect(result.current).toBeNull();
    rerender({ v: null });
    act(() => void vi.advanceTimersByTime(timing.holdMs + timing.showAfterMs));
    expect(result.current).toBeNull();
  });

  it("shows work that is still running at showAfterMs", () => {
    const { result } = renderHook(() => useSteadyValue("fetch", timing));
    act(() => void vi.advanceTimersByTime(timing.showAfterMs));
    expect(result.current).toBe("fetch");
  });

  it("switches straight to the next work while already shown", () => {
    const { result, rerender } = renderHook(({ v }) => useSteadyValue<string>(v, timing), {
      initialProps: { v: "fetch" as string | null },
    });
    act(() => void vi.advanceTimersByTime(timing.showAfterMs));
    rerender({ v: "pull" });
    expect(result.current).toBe("pull");
  });

  it("keeps the last work for holdMs after everything ends, then clears", () => {
    const { result, rerender } = renderHook(({ v }) => useSteadyValue<string>(v, timing), {
      initialProps: { v: "fetch" as string | null },
    });
    act(() => void vi.advanceTimersByTime(timing.showAfterMs));
    rerender({ v: null });
    act(() => void vi.advanceTimersByTime(timing.holdMs - 1));
    expect(result.current).toBe("fetch");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });
});

describe("useSteadyFlag", () => {
  it("uses the shared inline busy timing by default", () => {
    const { result, rerender } = renderHook(({ busy }) => useSteadyFlag(busy), { initialProps: { busy: true } });
    act(() => void vi.advanceTimersByTime(BUSY_TIMING.showAfterMs - 1));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    rerender({ busy: false });
    act(() => void vi.advanceTimersByTime(BUSY_TIMING.holdMs - 1));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("bridges short gaps between back-to-back work without flickering off", () => {
    const { result, rerender } = renderHook(({ busy }) => useSteadyFlag(busy), { initialProps: { busy: true } });
    act(() => void vi.advanceTimersByTime(BUSY_TIMING.showAfterMs));
    rerender({ busy: false });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ busy: true });
    expect(result.current).toBe(true);
  });
});
