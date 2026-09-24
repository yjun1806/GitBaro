// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_SEEN_STORAGE_KEY,
  REVIEW_SEEN_VERSION,
  baselinesFromScan,
  buildCountInputs,
  migrateReviewSeen,
  useReviewSeenStore,
} from "@/stores/review-seen";
import { useRepositoryStore } from "@/stores/repository";
import { mergeReviewStatus } from "@/hooks/useReviewStatus";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import type { RepoReviewStatus, ReviewWorktree } from "@/types";

const ALPHA = "/repos/alpha";
const ALPHA_WT = "/repos/alpha-wt/feature";
const BETA = "/repos/beta";
const BETA_WT = "/repos/beta-wt/agent";

function wt(path: string, isMain: boolean, headOid: string | null, branch: string | null = "main"): ReviewWorktree {
  return { path, isMain, headOid, branch };
}

function repo(repoPath: string, worktrees: ReviewWorktree[]): RepoReviewStatus {
  return { repoPath, worktrees };
}

function state() {
  return useReviewSeenStore.getState();
}

describe("useReviewSeenStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useReviewSeenStore.setState({
      entries: {},
      initialScanDone: false,
      scannedRepos: [],
      worktreesByRepo: {},
    });
  });

  it("첫 실행 스캔은 그때 있는 모든 워크트리의 HEAD를 기준선으로 잡는다", () => {
    state().applyScan(
      [repo(ALPHA, [wt(ALPHA, true, "a1"), wt(ALPHA_WT, false, "f1", "feature")])],
      1000,
    );

    expect(state().initialScanDone).toBe(true);
    expect(state().scannedRepos).toEqual([ALPHA]);
    expect(state().entries).toEqual({
      [ALPHA]: { branch: "main", oid: "a1", seenAt: 1000 },
      [ALPHA_WT]: { branch: "feature", oid: "f1", seenAt: 1000 },
    });
  });

  it("첫 실행 때 빠진 저장소가 돌아오면 그 저장소의 기존 워크트리도 모두 기준선을 잡는다", () => {
    // BETA는 외장 디스크가 빠져 있어 첫 스캔 응답에 없었다.
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    state().applyScan(
      [
        repo(ALPHA, [wt(ALPHA, true, "a1")]),
        repo(BETA, [wt(BETA, true, "b1"), wt(BETA_WT, false, "x1", "agent")]),
      ],
      2000,
    );

    expect(state().entries[BETA]).toEqual({ branch: "main", oid: "b1", seenAt: 2000 });
    expect(state().entries[BETA_WT]).toEqual({ branch: "agent", oid: "x1", seenAt: 2000 });
    expect(state().scannedRepos).toEqual([ALPHA, BETA]);
  });

  it("워크트리가 하나도 없는 스캔은 첫 실행으로 치지 않는다", () => {
    state().applyScan([], 1000);
    expect(state().initialScanDone).toBe(false);
  });

  it("첫 실행 뒤 새로 생긴 링크된 워크트리는 기준선 없이 남는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    state().applyScan(
      [repo(ALPHA, [wt(ALPHA, true, "a2"), wt(ALPHA_WT, false, "f1", "feature")])],
      2000,
    );

    expect(state().entries[ALPHA_WT]).toBeUndefined();
    // 이미 있던 기준선은 스캔이 옮기지 않는다.
    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a1", seenAt: 1000 });
  });

  it("추가된 저장소를 한 번 스캔한 뒤 생긴 링크된 워크트리는 기준선 없이 남는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")]), repo(BETA, [wt(BETA, true, "b1")])], 2000);
    state().applyScan(
      [
        repo(ALPHA, [wt(ALPHA, true, "a1")]),
        repo(BETA, [wt(BETA, true, "b2"), wt(BETA_WT, false, "x1", "agent")]),
      ],
      3000,
    );

    expect(state().entries[BETA]).toEqual({ branch: "main", oid: "b1", seenAt: 2000 });
    expect(state().entries[BETA_WT]).toBeUndefined();
  });

  it("기준선이 없던 메인 작업 트리는 커밋이 생기면 현재 HEAD로 잡는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, null)])], 1000);
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1"), wt(ALPHA_WT, false, "f1")])], 2000);
    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a1", seenAt: 2000 });
    expect(state().entries[ALPHA_WT]).toBeUndefined();
  });

  it("HEAD가 없는 워크트리(커밋 없는 저장소)는 기준선을 잡지 않는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, null)])], 1000);
    expect(state().entries).toEqual({});
    expect(state().initialScanDone).toBe(true);
  });

  it("바뀐 게 없는 스캔은 상태 객체를 새로 만들지 않는다", () => {
    const scan = [repo(ALPHA, [wt(ALPHA, true, "a1"), wt(ALPHA_WT, false, "f1")])];
    state().applyScan(scan, 1000);
    useReviewSeenStore.setState({ entries: { [ALPHA]: state().entries[ALPHA] } });
    const before = state().entries;
    state().applyScan(scan, 2000);
    expect(state().entries).toBe(before);
    expect(
      baselinesFromScan(
        {
          entries: before,
          initialScanDone: true,
          scannedRepos: [ALPHA],
          worktreesByRepo: { [ALPHA]: [ALPHA, ALPHA_WT] },
        },
        scan,
        3000,
      ),
    ).toBeNull();
  });

  it("markSeen은 기준선을 지금 HEAD와 브랜치로 옮긴다", () => {
    state().markSeen(ALPHA_WT, "f9", "feature");
    const entry = state().entries[ALPHA_WT];
    expect(entry.oid).toBe("f9");
    expect(entry.branch).toBe("feature");
    expect(entry.seenAt).toBeGreaterThan(0);
  });

  it("v1 저장값을 그대로 복원한다", async () => {
    localStorage.setItem(
      REVIEW_SEEN_STORAGE_KEY,
      JSON.stringify({
        state: {
          entries: { [ALPHA]: { branch: "main", oid: "a1", seenAt: 1000 } },
          initialScanDone: true,
          scannedRepos: [ALPHA],
        },
        version: 1,
      }),
    );

    await useReviewSeenStore.persist.rehydrate();

    expect(state().initialScanDone).toBe(true);
    expect(state().scannedRepos).toEqual([ALPHA]);
    expect(state().entries).toEqual({ [ALPHA]: { branch: "main", oid: "a1", seenAt: 1000 } });
  });

  it("저장할 때 v1 형식으로 쓴다", () => {
    state().markSeen(ALPHA, "a1", null);
    const saved = JSON.parse(localStorage.getItem(REVIEW_SEEN_STORAGE_KEY) ?? "{}");
    expect(saved.version).toBe(REVIEW_SEEN_VERSION);
    expect(Object.keys(saved.state).sort()).toEqual([
      "entries",
      "initialScanDone",
      "scannedRepos",
      "worktreesByRepo",
    ]);
    expect(saved.state.entries[ALPHA]).toMatchObject({ branch: null, oid: "a1" });
  });

  it("깨진 항목은 복원하지 않는다", async () => {
    localStorage.setItem(
      REVIEW_SEEN_STORAGE_KEY,
      JSON.stringify({
        state: {
          entries: {
            [ALPHA]: { branch: "main", oid: "a1", seenAt: 1000 },
            [BETA]: { branch: 3, oid: "b1", seenAt: 1000 },
            [BETA_WT]: { branch: "x", oid: "", seenAt: 1000 },
          },
          initialScanDone: "yes",
          scannedRepos: [ALPHA, 7],
        },
        version: 1,
      }),
    );

    await useReviewSeenStore.persist.rehydrate();

    expect(Object.keys(state().entries)).toEqual([ALPHA]);
    expect(state().initialScanDone).toBe(false);
    expect(state().scannedRepos).toEqual([ALPHA]);
  });
});

describe("migrateReviewSeen", () => {
  it("알 수 없는 버전의 값에서 알아볼 수 있는 항목만 남긴다", () => {
    expect(
      migrateReviewSeen(
        { entries: { [ALPHA]: { branch: null, oid: "a1", seenAt: 5 } }, initialScanDone: true },
        0,
      ),
    ).toEqual({
      entries: { [ALPHA]: { branch: null, oid: "a1", seenAt: 5 } },
      initialScanDone: true,
      scannedRepos: [],
      worktreesByRepo: {},
    });
    expect(migrateReviewSeen(null, 0)).toEqual({
      entries: {},
      initialScanDone: false,
      scannedRepos: [],
      worktreesByRepo: {},
    });
  });
});

describe("buildCountInputs", () => {
  it("기준선이 있으면 함께 넘기고, 없으면 경로만 넘긴다", () => {
    const repos = [
      repo(ALPHA, [wt(ALPHA, true, "a2"), wt(ALPHA_WT, false, "f1", "feature"), wt("/empty", false, null)]),
    ];
    expect(
      buildCountInputs(repos, { [ALPHA]: { branch: "main", oid: "a1", seenAt: 1000 } }, [ALPHA]),
    ).toEqual([
      { path: ALPHA, oid: "a1", seenAt: 1000, branch: "main" },
      { path: ALPHA_WT },
    ]);
  });

  it("아직 스캔 기록이 없는 저장소는 기준선을 잡기 전이라 세지 않는다", () => {
    const repos = [repo(ALPHA, [wt(ALPHA, true, "a1")]), repo(BETA, [wt(BETA, true, "b1")])];
    expect(buildCountInputs(repos, {}, [ALPHA])).toEqual([{ path: ALPHA }]);
  });
});

describe("지운 저장소 정리", () => {
  const alphaRepo = makeRepo("alpha", null);
  const betaRepo = makeRepo("beta", null);

  beforeEach(() => {
    useRepositoryStore.setState({ repos: [alphaRepo, betaRepo] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useRepositoryStore.setState({ repos: [] });
  });

  it("forgetRepos는 그 저장소의 기준선과 링크된 워크트리 기준선, scannedRepos 기록을 지운다", () => {
    state().applyScan(
      [
        repo(ALPHA, [wt(ALPHA, true, "a1"), wt(ALPHA_WT, false, "f1", "feature")]),
        repo(BETA, [wt(BETA, true, "b1")]),
      ],
      1000,
    );

    state().forgetRepos([ALPHA]);

    expect(state().entries).toEqual({ [BETA]: { branch: "main", oid: "b1", seenAt: 1000 } });
    expect(state().scannedRepos).toEqual([BETA]);
  });

  it("저장소 폴더 밖(형제 폴더)에 만든 워크트리의 기준선도 함께 지운다", () => {
    // 앱이 기본 제안하는 워크트리 위치는 저장소 폴더 옆이다 (CreateWorktreeDialog의
    // suggestWorktreePath: `${parent}/${repo}-${branch}`), 저장소 폴더 안이 아니다.
    // belongsToRepo의 경로 접두어 판정만으로는 이런 워크트리를 찾지 못하므로
    // forgetRepos는 마지막 스캔이 기록한 worktreesByRepo로 대신 찾아야 한다.
    const SIBLING_WT = "/repos/alpha-feat/work";
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1"), wt(SIBLING_WT, false, "f1", "feat")])], 1000);
    expect(state().entries[SIBLING_WT]).toBeDefined();

    state().forgetRepos([ALPHA]);

    expect(state().entries[SIBLING_WT]).toBeUndefined();
    expect(state().worktreesByRepo[ALPHA]).toBeUndefined();
  });

  it("형제 폴더 워크트리를 지운 뒤 저장소를 다시 추가하면 새 커밋 수가 0부터 다시 잡힌다", () => {
    const SIBLING_WT = "/repos/alpha-feat/work";
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1"), wt(SIBLING_WT, false, "x1", "feat")])], 1000);

    useRepositoryStore.getState().removeRepo(ALPHA);
    expect(state().entries[SIBLING_WT]).toBeUndefined();

    useRepositoryStore.getState().addRepo(alphaRepo);
    // 그 사이 30개 커밋이 쌓였어도 첫 실행으로 다시 잡혀 옛 기준선(x1)이 아니라
    // 새 HEAD를 기준선으로 삼는다.
    state().applyScan(
      [repo(ALPHA, [wt(ALPHA, true, "a1"), wt(SIBLING_WT, false, "x31", "feat")])],
      2000,
    );
    expect(state().entries[SIBLING_WT]).toEqual({ branch: "feat", oid: "x31", seenAt: 2000 });
  });

  it("저장소를 지우면 기준선도 함께 지워져, 다시 추가했을 때 첫 실행으로 다시 잡힌다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a1", seenAt: 1000 });

    useRepositoryStore.getState().removeRepo(ALPHA);
    expect(state().entries[ALPHA]).toBeUndefined();
    expect(state().scannedRepos).toEqual([]);

    useRepositoryStore.getState().addRepo(alphaRepo);
    // 재추가 뒤 200개 커밋이 쌓인 상태를 다시 스캔해도, 첫 실행으로 잡혀 기준선이
    // 새 HEAD가 된다 — 옛 기준선이 남아 200개가 새 커밋으로 보이는 사고를 막는다.
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a201")])], 2000);
    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a201", seenAt: 2000 });
  });

  it("저장소 스토어가 복원되기 전의 빈 repos로는 정리하지 않는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    vi.spyOn(useRepositoryStore.persist, "hasHydrated").mockReturnValue(false);

    useRepositoryStore.setState({ repos: [] });

    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a1", seenAt: 1000 });
  });

  it("이 스토어가 복원되기 전에도 정리하지 않는다", () => {
    state().applyScan([repo(ALPHA, [wt(ALPHA, true, "a1")])], 1000);
    vi.spyOn(useReviewSeenStore.persist, "hasHydrated").mockReturnValue(false);

    useRepositoryStore.setState({ repos: [betaRepo] });

    expect(state().entries[ALPHA]).toEqual({ branch: "main", oid: "a1", seenAt: 1000 });
  });
});

describe("mergeReviewStatus", () => {
  it("스캔과 개수를 경로별로 합치고, 못 센 워크트리는 null로 둔다", () => {
    const repos = [repo(ALPHA, [wt(ALPHA, true, "a2"), wt(ALPHA_WT, false, "f1", "feature")])];
    const merged = mergeReviewStatus(repos, [
      { path: ALPHA, headOid: "a2", newCount: 3, basis: "oid" },
    ]);
    expect(merged[ALPHA]).toMatchObject({ repoPath: ALPHA, newCount: 3, basis: "oid", isMain: true });
    expect(merged[ALPHA_WT]).toMatchObject({ repoPath: ALPHA, newCount: null, basis: null });
  });
});
