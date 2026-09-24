import { beforeEach, describe, expect, it } from "vitest";
import { REPOS_KEY, selectActivityTargets, useActivityTargetsStore } from "../activity-targets";

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

  // 등록된 저장소 전체("repos" key)가 40곳 상한에서 다른 화면보다 우선해야
  // 한다(결정 기록 참고). 등록 순서에만 기대면 깨진다 — 예를 들어 자식
  // 컴포넌트(사이드바)의 effect가 부모(MainLayout)보다 먼저 돌아 "sidebar"
  // key가 먼저 들어오면, "repos"가 뒤로 밀려 40곳을 두고 다투다 진다.
  it("registered repositories keep priority even when another key registers first", () => {
    const merged = selectActivityTargets({
      sidebar: ["/wt/1", "/wt/2"],
      [REPOS_KEY]: ["/repo/a", "/repo/b"],
    });

    expect(merged).toEqual(["/repo/a", "/repo/b", "/wt/1", "/wt/2"]);
  });

  it("still dedupes across keys once priority is applied", () => {
    const merged = selectActivityTargets({
      sidebar: ["/repo/a", "/wt/1"],
      [REPOS_KEY]: ["/repo/a", "/repo/b"],
    });

    expect(merged).toEqual(["/repo/a", "/repo/b", "/wt/1"]);
  });
});
