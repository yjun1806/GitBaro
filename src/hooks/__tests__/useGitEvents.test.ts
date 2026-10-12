// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const unlisten = vi.fn();
const resolvers: (() => void)[] = [];
let delayed = false;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: Handler) => {
    handlers.set(name, handler);
    const off = () => {
      unlisten(name);
      handlers.delete(name);
    };
    if (!delayed) return Promise.resolve(off);
    return new Promise<() => void>((resolve) => resolvers.push(() => resolve(off)));
  }),
}));

const { useGitEvents } = await import("../useGitEvents");
const { useActivityStore } = await import("@/stores/activity");

beforeEach(() => {
  handlers.clear();
  unlisten.mockClear();
  resolvers.length = 0;
  delayed = false;
});

describe("useGitEvents", () => {
  it("unlistens all three git events even when it unmounts before the subscriptions resolve", async () => {
    delayed = true;
    const { unmount } = renderHook(() => useGitEvents());
    unmount();
    await act(async () => {
      resolvers.forEach((resolve) => resolve());
    });
    expect(unlisten.mock.calls.map(([name]) => name).sort()).toEqual([
      "git:command-complete",
      "git:command-progress",
      "git:command-start",
    ]);
    expect(handlers.size).toBe(0);
  });

  it("records a started command and unlistens on a normal unmount", async () => {
    const { unmount } = renderHook(() => useGitEvents());
    await act(async () => {});
    handlers.get("git:command-start")?.({
      payload: { id: "c1", command: "git fetch", operation: "fetch", repoPath: "/r", startedAt: 1, automatic: false },
    });
    expect(useActivityStore.getState().entries.some((e) => e.id === "c1")).toBe(true);
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(3);
  });
});
