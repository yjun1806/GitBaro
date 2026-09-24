import { beforeEach, describe, expect, it } from "vitest";
import { useSyncStore } from "../sync";

describe("useSyncStore", () => {
  beforeEach(() => {
    useSyncStore.setState({ syncingByRepo: {}, lastFetchedByRepo: {} });
  });

  it("keeps each repository's sync state separate", () => {
    const { startSync, finishSync } = useSyncStore.getState();
    startSync("/repos/a", "push");
    startSync("/repos/b", "fetch");
    finishSync("/repos/b");

    expect(useSyncStore.getState().syncingByRepo).toEqual({ "/repos/a": "push" });
  });

  it("records the last fetch time per repository", () => {
    const { markFetched } = useSyncStore.getState();
    markFetched("/repos/a", 100);
    markFetched("/repos/b", 200);

    expect(useSyncStore.getState().lastFetchedByRepo).toEqual({ "/repos/a": 100, "/repos/b": 200 });
  });
});
