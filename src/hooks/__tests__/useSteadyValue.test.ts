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

  interface Progress {
    id: string;
    percent: number;
  }
  const byId = (v: Progress) => v.id;

  it("still shows after showAfterMs when the same work arrives as a new object every 100ms", () => {
    // 진행률 갱신마다 새 객체가 온다(activity.ts의 updateProgress). id가 같은 한 타이머가
    // 되돌아가면 안 된다 — 되돌아가면 300ms 문턱을 영영 못 넘는다.
    const { result, rerender } = renderHook(({ v }) => useSteadyValue<Progress>(v, timing, byId), {
      initialProps: { v: { id: "a", percent: 0 } as Progress | null },
    });
    for (let percent = 10; percent <= 100; percent += 10) {
      act(() => void vi.advanceTimersByTime(100));
      rerender({ v: { id: "a", percent } });
    }
    expect(result.current).not.toBeNull();
    // 보이는 동안에는 늘 최신 객체(최신 진행률)를 돌려준다.
    expect(result.current?.percent).toBe(100);
  });

  it("restarts the show timer when the key actually changes, even with a keyOf", () => {
    const { result, rerender } = renderHook(({ v }) => useSteadyValue<Progress>(v, timing, byId), {
      initialProps: { v: { id: "a", percent: 0 } as Progress | null },
    });
    act(() => void vi.advanceTimersByTime(timing.showAfterMs - 1));
    rerender({ v: { id: "b", percent: 0 } });
    // 다른 일로 바뀌었지만 이미 보이는 중이 아니었으니(아직 300ms 전) 곧바로 보이지 않는다.
    expect(result.current).toBeNull();
  });

  it("does not leak timers across rapid toggles and an unmount", () => {
    const { rerender, unmount } = renderHook(({ v }) => useSteadyValue<string>(v, timing), {
      initialProps: { v: "fetch" as string | null },
    });
    rerender({ v: null });
    rerender({ v: "pull" });
    rerender({ v: null });
    rerender({ v: "push" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
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
