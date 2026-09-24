import { beforeEach, describe, expect, it } from "vitest";
import { selectActivityTargets, useActivityTargetsStore } from "../activity-targets";

describe("useActivityTargetsStore", () => {
  beforeEach(() => {
    useActivityTargetsStore.setState({ extraByKey: {} });
  });

  it("registers a screen's watch paths under its key", () => {
    const { registerWatchPaths } = useActivityTargetsStore.getState();
    registerWatchPaths("repos", ["/repo/a", "/repo/b"]);

    expect(useActivityTargetsStore.getState().extraByKey).toEqual({
      repos: ["/repo/a", "/repo/b"],
    });
  });

  it("replaces a key's paths on re-registration", () => {
    const { registerWatchPaths } = useActivityTargetsStore.getState();
    registerWatchPaths("sidebar", ["/repo/a"]);
    registerWatchPaths("sidebar", ["/repo/a", "/repo/c"]);

    expect(useActivityTargetsStore.getState().extraByKey.sidebar).toEqual(["/repo/a", "/repo/c"]);
  });

  it("unregisters a key, dropping only its paths", () => {
    const { registerWatchPaths, unregisterWatchPaths } = useActivityTargetsStore.getState();
    registerWatchPaths("repos", ["/repo/a"]);
    registerWatchPaths("sidebar", ["/repo/b"]);
    unregisterWatchPaths("sidebar");

    expect(useActivityTargetsStore.getState().extraByKey).toEqual({ repos: ["/repo/a"] });
  });
});

describe("selectActivityTargets", () => {
  it("merges every key's paths, deduplicated, in registration order", () => {
    const merged = selectActivityTargets({
      repos: ["/repo/a", "/repo/b"],
      sidebar: ["/repo/b", "/repo/c"],
    });

    expect(merged).toEqual(["/repo/a", "/repo/b", "/repo/c"]);
  });

  it("returns an empty list when nothing is registered", () => {
    expect(selectActivityTargets({})).toEqual([]);
  });
});
