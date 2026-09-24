import { beforeEach, describe, expect, it } from "vitest";
import { LIVE_CHANGE_STALE_MS, useLiveChangesStore } from "../live-changes";

describe("useLiveChangesStore", () => {
  beforeEach(() => {
    useLiveChangesStore.setState({ lastChangedAt: {}, watched: [], overflow: [] });
  });

  it("records a change and reports it as recent", () => {
    const { recordChange } = useLiveChangesStore.getState();
    const now = 1_000_000;
    recordChange("/repo/a", now);

    expect(useLiveChangesStore.getState().lastChangedAt).toEqual({ "/repo/a": now });
    expect(useLiveChangesStore.getState().recentChangedPaths(now)).toEqual(["/repo/a"]);
  });

  it("ignores an out-of-order (older) update for the same path", () => {
    const { recordChange } = useLiveChangesStore.getState();
    recordChange("/repo/a", 2_000);
    recordChange("/repo/a", 1_000);

    expect(useLiveChangesStore.getState().lastChangedAt["/repo/a"]).toBe(2_000);
  });

  it("keeps a change that is exactly at the 10-minute boundary", () => {
    const { recordChange } = useLiveChangesStore.getState();
    const at = 0;
    recordChange("/repo/a", at);

    expect(useLiveChangesStore.getState().recentChangedPaths(at + LIVE_CHANGE_STALE_MS)).toEqual([
      "/repo/a",
    ]);
  });

  it("drops a change once it passes the 10-minute boundary", () => {
    const { recordChange } = useLiveChangesStore.getState();
    const at = 0;
    recordChange("/repo/a", at);

    expect(
      useLiveChangesStore.getState().recentChangedPaths(at + LIVE_CHANGE_STALE_MS + 1),
    ).toEqual([]);
  });

  it("orders recent paths from most to least recently changed", () => {
    const { recordChange } = useLiveChangesStore.getState();
    const now = 1_000_000;
    recordChange("/repo/older", now - 5_000);
    recordChange("/repo/newer", now - 1_000);

    expect(useLiveChangesStore.getState().recentChangedPaths(now)).toEqual([
      "/repo/newer",
      "/repo/older",
    ]);
  });

  it("stores which paths are watched vs. overflowed, for the fallback poll", () => {
    const { setWatchState, recordChange } = useLiveChangesStore.getState();
    setWatchState(["/repo/a"], ["/repo/b"]);
    // The overflow path is filled from the 20s poll's dirtyLatestMtime instead
    // of a repo:activity event — same recordChange call either way.
    recordChange("/repo/b", 5_000);

    const state = useLiveChangesStore.getState();
    expect(state.watched).toEqual(["/repo/a"]);
    expect(state.overflow).toEqual(["/repo/b"]);
    expect(state.lastChangedAt["/repo/b"]).toBe(5_000);
  });
});
