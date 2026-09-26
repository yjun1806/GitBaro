import { describe, expect, it } from "vitest";
import type { Scope } from "../scope";
import {
  branchLaneId,
  isLaneShownByDefault,
  isQuietLane,
  isRepoActive,
  laneColorsFor,
  openedLaneId,
  pinnedLaneId,
  sharedRemoteName,
  visibleLaneSources,
  type LaneSource,
} from "../scope-lanes";

function lane(overrides: Partial<LaneSource>): LaneSource {
  return {
    id: "/w/a",
    repoPath: "/r/a",
    worktreePath: "/w/a",
    isMain: true,
    branch: "main",
    defaultBranch: "main",
    unpushedCount: 0,
    wipCount: 0,
    error: null,
    remotes: ["origin"],
    color: "",
    ...overrides,
  };
}

describe("branchLaneId", () => {
  it("keys a not-checked-out branch lane by repo and branch, never colliding with a worktree path", () => {
    expect(branchLaneId("/r/a", "feat/x")).toBe("/r/a\u0000feat/x");
    expect(branchLaneId("/r/a", "feat/x")).not.toBe("/r/a");
  });
});

describe("isQuietLane (저장소 리뷰의 조용함 규칙을 레인 하나에 그대로 적용)", () => {
  it("is quiet on the default branch with nothing to review", () => {
    expect(isQuietLane(lane({}))).toBe(true);
  });

  it("is not quiet with unpushed commits, WIP, or an off-default branch", () => {
    expect(isQuietLane(lane({ unpushedCount: 1 }))).toBe(false);
    expect(isQuietLane(lane({ wipCount: 1 }))).toBe(false);
    expect(isQuietLane(lane({ branch: "feat/x" }))).toBe(false);
  });
});

describe("isRepoActive", () => {
  const quietMain = lane({ id: "/w/a", repoPath: "/r/a" });
  const busyOther = lane({ id: "/w/a-2", repoPath: "/r/a", isMain: false, branch: "feat/x" });

  it("is active if any lane of the repo is not quiet", () => {
    expect(isRepoActive([quietMain, busyOther], "/r/a")).toBe(true);
    expect(isRepoActive([quietMain], "/r/a")).toBe(false);
  });

  it("does not consider lanes of a different repository", () => {
    expect(isRepoActive([busyOther], "/r/other")).toBe(false);
  });
});

describe("pinnedLaneId (늘 켜져 있는 레인)", () => {
  const main = lane({ id: "/w/a", isMain: true });
  const other = lane({ id: "/w/a-2", isMain: false });

  it("pins the lane itself at branch scope", () => {
    const scope: Scope = { kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: "/w/a" };
    expect(pinnedLaneId(scope, [main])).toBe("/w/a");
  });

  it("pins the main worktree at repo scope, falling back to the first lane", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    expect(pinnedLaneId(scope, [other, main])).toBe("/w/a");
    expect(pinnedLaneId(scope, [other])).toBe("/w/a-2");
  });

  it("pins nothing at workspace scope", () => {
    expect(pinnedLaneId({ kind: "workspace", workspaceId: "w1" }, [main])).toBeNull();
  });
});

describe("isLaneShownByDefault", () => {
  const quietMain = lane({ isMain: true });
  const quietOther = lane({ id: "/w/a-2", isMain: false });

  it("hides a quiet non-main lane at workspace scope but keeps the quiet main lane", () => {
    const scope: Scope = { kind: "workspace", workspaceId: "w1" };
    expect(isLaneShownByDefault(scope, quietMain)).toBe(true);
    expect(isLaneShownByDefault(scope, quietOther)).toBe(false);
  });

  it("hides any quiet lane at repo scope (the pinned main lane is forced separately)", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    expect(isLaneShownByDefault(scope, quietMain)).toBe(false);
    expect(isLaneShownByDefault(scope, quietOther)).toBe(false);
  });
});

describe("visibleLaneSources", () => {
  const main = lane({ id: "/w/a", isMain: true });
  const quietOther = lane({ id: "/w/a-2", isMain: false });
  const busyOther = lane({ id: "/w/a-3", isMain: false, branch: "feat/x", unpushedCount: 1 });
  const sources = [main, quietOther, busyOther];

  it("shows the pinned lane and non-quiet lanes by default at repo scope", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    const shown = visibleLaneSources(scope, sources, new Map(), new Map());
    expect(shown.map((s) => s.id)).toEqual(["/w/a", "/w/a-3"]);
  });

  it("lets an explicit lane override turn a quiet lane on", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    const shown = visibleLaneSources(scope, sources, new Map(), new Map([["/w/a-2", true]]));
    expect(shown.map((s) => s.id)).toEqual(["/w/a", "/w/a-2", "/w/a-3"]);
  });

  it("hides a whole repo's lanes at workspace scope when its chip is off, even the main lane", () => {
    const scope: Scope = { kind: "workspace", workspaceId: "w1" };
    const shown = visibleLaneSources(scope, sources, new Map([["/r/a", false]]), new Map());
    expect(shown).toEqual([]);
  });

  it("keeps input order", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    const reordered = [busyOther, main, quietOther];
    const shown = visibleLaneSources(scope, reordered, new Map(), new Map());
    expect(shown.map((s) => s.id)).toEqual(["/w/a-3", "/w/a"]);
  });
});

describe("openedLaneId (쓰기가 되는 레인)", () => {
  it("is the lane itself only at branch scope, and only when checked out", () => {
    const checkedOut: Scope = { kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: "/w/a" };
    const viewing: Scope = { kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: null };
    const source = lane({ id: "/w/a" });
    expect(openedLaneId(checkedOut, [source])).toBe("/w/a");
    expect(openedLaneId(viewing, [{ ...source, worktreePath: null }])).toBeNull();
    expect(openedLaneId({ kind: "repo", repoPath: "/r/a" }, [source])).toBeNull();
    expect(openedLaneId({ kind: "workspace", workspaceId: "w1" }, [source])).toBeNull();
  });
});

describe("sharedRemoteName (영역 머리의 원격 이름 규칙)", () => {
  it("names the remote when every lane pushes to exactly one, and they agree", () => {
    expect(sharedRemoteName([{ remotes: ["origin"] }, { remotes: ["origin"] }])).toBe("origin");
  });

  it("is null with no lanes, mismatched names, or a lane with more than one remote", () => {
    expect(sharedRemoteName([])).toBeNull();
    expect(sharedRemoteName([{ remotes: ["origin"] }, { remotes: ["upstream"] }])).toBeNull();
    expect(sharedRemoteName([{ remotes: ["origin", "upstream"] }])).toBeNull();
  });
});

describe("laneColorsFor", () => {
  it("gives lanes of the same repo the same hue at workspace scope, varied by lightness", () => {
    const scope: Scope = { kind: "workspace", workspaceId: "w1" };
    const colors = laneColorsFor(scope, [
      { id: "/w/a", repoPath: "/r/a" },
      { id: "/w/a-2", repoPath: "/r/a" },
      { id: "/w/b", repoPath: "/r/b" },
    ]);
    const hueOf = (color: string) => /hsl\((\d+)/.exec(color)?.[1];
    expect(hueOf(colors.get("/w/a")!)).toBe(hueOf(colors.get("/w/a-2")!));
    expect(colors.get("/w/a")).not.toBe(colors.get("/w/a-2"));
    expect(hueOf(colors.get("/w/a")!)).not.toBe(hueOf(colors.get("/w/b")!));
  });

  it("gives each lane its own hue at repo scope", () => {
    const scope: Scope = { kind: "repo", repoPath: "/r/a" };
    const colors = laneColorsFor(scope, [
      { id: "/w/a", repoPath: "/r/a" },
      { id: "/w/a-2", repoPath: "/r/a" },
    ]);
    expect(colors.get("/w/a")).not.toBe(colors.get("/w/a-2"));
  });

  it("is stable regardless of lane order (color keyed by repo path + position within it)", () => {
    const scope: Scope = { kind: "workspace", workspaceId: "w1" };
    const forward = laneColorsFor(scope, [
      { id: "/w/a", repoPath: "/r/a" },
      { id: "/w/a-2", repoPath: "/r/a" },
    ]);
    const same = laneColorsFor(scope, [
      { id: "/w/a", repoPath: "/r/a" },
      { id: "/w/a-2", repoPath: "/r/a" },
    ]);
    expect(forward.get("/w/a")).toBe(same.get("/w/a"));
    expect(forward.get("/w/a-2")).toBe(same.get("/w/a-2"));
  });
});
