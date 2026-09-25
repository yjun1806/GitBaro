import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoInfo } from "@/types";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const { openNotificationTarget } = await import("../open-target");
const { useRepositoryStore } = await import("@/stores/repository");
const { useUIStore } = await import("@/stores/ui");
const { usePrViewStore } = await import("@/components/pr/pr-view");
const { useFilesViewStore } = await import("@/components/review/files-view");

const REPO = "/work/app";
const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

beforeEach(() => {
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  // 이미 기록 탭이면 탭 값이 바뀌지 않아 GraphPanel의 탭 효과가 PR·파일 보기를 닫지 않는다.
  useUIStore.setState({ activeTab: "history" });
  usePrViewStore.setState({ open: true });
  useFilesViewStore.setState({ repoTabOpen: true });
});

describe("openNotificationTarget", () => {
  it.each([
    { kind: "commit", repoPath: REPO, worktreePath: REPO, commitOid: "abc" },
    { kind: "ci", repoPath: REPO, worktreePath: REPO, runId: 7 },
  ] as const)("closes the PR view and the files tab so the $kind target is visible", (target) => {
    openNotificationTarget(target);
    expect(usePrViewStore.getState().open).toBe(false);
    expect(useFilesViewStore.getState().repoTabOpen).toBe(false);
  });
});
