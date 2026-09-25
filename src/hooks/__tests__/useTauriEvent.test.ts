// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ActivityEvent } from "@/types";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => {
      unlisten(name);
      handlers.delete(name);
    };
  }),
}));

const { listen } = await import("@tauri-apps/api/event");
const { useTauriEvent } = await import("../useTauriEvent");
const { TAURI_EVENTS } = await import("@/api/events");

const activity: ActivityEvent = { path: "/r/app", at: 1, kind: "workTree" };

beforeEach(() => {
  handlers.clear();
  unlisten.mockClear();
  vi.mocked(listen).mockClear();
});

describe("useTauriEvent", () => {
  it("calls the latest handler without subscribing again", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useTauriEvent(TAURI_EVENTS.repoActivity, fn), {
      initialProps: { fn: first },
    });
    await act(async () => {});
    rerender({ fn: second });
    act(() => handlers.get("repo:activity")?.({ payload: activity }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(activity);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("stops listening on unmount, even when unmounted before the subscription resolves", async () => {
    const early = renderHook(() => useTauriEvent(TAURI_EVENTS.fsChange, vi.fn()));
    early.unmount();
    await act(async () => {});
    expect(unlisten).toHaveBeenCalledWith("fs:change");

    unlisten.mockClear();
    const late = renderHook(() => useTauriEvent(TAURI_EVENTS.fsChange, vi.fn()));
    await act(async () => {});
    late.unmount();
    expect(unlisten).toHaveBeenCalledWith("fs:change");
  });

  it("does not subscribe while disabled", async () => {
    renderHook(() => useTauriEvent(TAURI_EVENTS.fsGitDirChange, vi.fn(), false));
    await act(async () => {});
    expect(listen).not.toHaveBeenCalled();
  });
});
