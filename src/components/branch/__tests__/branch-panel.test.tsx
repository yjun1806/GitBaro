// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { BranchBaseInfo, BranchInfo, WorktreeBase, WorktreeInfo } from "@/types";

const baseCalls: string[][] = [];
const BASES: Record<string, WorktreeBase> = {
  "feat/review-stream": { name: "fix/audit-bugs", source: "reflog", aheadOfBase: 4, behindBase: 0 },
  "docs/readme": { name: "main", source: "inferred", aheadOfBase: 1, behindBase: 2 },
  "fix/merged": { name: "fix/audit-bugs", source: "reflog", aheadOfBase: 0, behindBase: 3 },
  "fix/idle": { name: "main", source: "reflog", aheadOfBase: 0, behindBase: 5 },
};
const MERGED = new Set(["fix/merged"]);
let recentNames: string[] = [];
vi.mock("@/api/queries", () => ({
  useBranchBases: (_path: string | null, names: readonly string[]) => {
    baseCalls.push([...names]);
    return new Map<string, BranchBaseInfo>(
      names.map((n) => [n, { name: n, base: BASES[n] ?? null, mergedIntoBase: MERGED.has(n) }]),
    );
  },
  useRecentBranches: () => ({ data: recentNames }),
}));
vi.mock("@/hooks/use-avatar-resolver", () => ({ useAvatarResolver: () => () => undefined }));

const { BranchPanel } = await import("../BranchPanel");

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

function worktree(path: string, branchName: string, isMain = false): WorktreeInfo {
  return {
    path,
    head: "abc",
    branch: branchName,
    isMain,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    base: null,
  };
}

const NOW = Math.floor(Date.now() / 1000);
const MAIN = "/work/GitBaro";
const AUDIT = "/work/GitBaro/.claude/worktrees/audit-bugs";
const REVIEW = "/work/GitBaro/.claude/worktrees/review-stream";

const handlers = {
  onSwitch: vi.fn(),
  onOpenWorktree: vi.fn(),
  onCompare: vi.fn(),
  onMerge: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onCopyName: vi.fn(),
  onCreateBranch: vi.fn(),
  onClose: vi.fn(),
};

const anchorRef = { current: null as HTMLElement | null };

function renderPanel(currentBranch: string | null = "fix/audit-bugs") {
  return render(
    <BranchPanel
      anchorRef={anchorRef}
      repoName="GitBaro"
      activeRepoPath={AUDIT}
      currentBranch={currentBranch}
      branches={[
        branch("main", { isDefault: true, upstream: "origin/main", aheadBehind: { ahead: 0, behind: 0 } }),
        branch("fix/audit-bugs", { isHead: currentBranch !== null }),
        branch("feat/review-stream", { lastCommitAuthor: { name: "Claude", email: "c@x" }, lastCommitTime: NOW - 60 }),
        branch("docs/readme", { lastCommitTime: NOW - 26 * 60 }),
        branch("fix/merged", { lastCommitTime: NOW - 3600 }),
        branch("fix/idle", { lastCommitTime: NOW - 7200 }),
        branch("origin/main", { isRemote: true }),
        branch("origin/feature/ai-commit", { isRemote: true, lastCommitTime: NOW - 14 * 86400 }),
      ]}
      worktrees={[worktree(MAIN, "main", true), worktree(AUDIT, "fix/audit-bugs"), worktree(REVIEW, "feat/review-stream")]}
      {...handlers}
    />,
  );
}

function row(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-branch-name="${name}"]`);
  if (!el) throw new Error(`no row ${name}`);
  return el;
}

beforeEach(async () => {
  await i18n.changeLanguage("ko");
  baseCalls.length = 0;
  recentNames = [];
  Object.values(handlers).forEach((h) => h.mockReset());
});
afterEach(cleanup);

describe("BranchPanel", () => {
  it("shows the three sections from the mockup", () => {
    renderPanel();
    const sections = screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"));
    expect(sections).toEqual(["워크트리에서 쓰는 중", "로컬", "원격 · origin"]);
    const inWorktree = screen.getByRole("region", { name: "워크트리에서 쓰는 중" });
    const rows = [...inWorktree.querySelectorAll("[data-branch-name]")].map((el) => el.getAttribute("data-branch-name"));
    expect(rows).toEqual(["fix/audit-bugs", "main", "feat/review-stream"]);
  });

  it("offers 이동 instead of 전환 for a branch another worktree uses, and opens that worktree", () => {
    renderPanel();
    const review = within(row("feat/review-stream"));
    expect(review.queryByRole("button", { name: "전환" })).toBeNull();
    fireEvent.click(review.getByRole("button", { name: "이동" }));
    expect(handlers.onOpenWorktree).toHaveBeenCalledWith(REVIEW);
    expect(handlers.onSwitch).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalled();

    // 메인 워크트리가 쓰는 main도 이동이다.
    expect(within(row("main")).getByRole("button", { name: "이동" })).toBeTruthy();
    // 지금 브랜치에는 전환·이동이 없다.
    const current = within(row("fix/audit-bugs"));
    expect(current.queryByRole("button", { name: "전환" })).toBeNull();
    expect(current.queryByRole("button", { name: "이동" })).toBeNull();
  });

  it("switches a local branch and compares or merges from the row", () => {
    renderPanel();
    const docs = within(row("docs/readme"));
    fireEvent.click(docs.getByRole("button", { name: "전환" }));
    expect(handlers.onSwitch).toHaveBeenCalledWith("docs/readme");
    fireEvent.click(docs.getByRole("button", { name: "비교" }));
    expect(handlers.onCompare).toHaveBeenCalledWith("docs/readme");
    fireEvent.click(docs.getByRole("button", { name: "Merge…" }));
    expect(handlers.onMerge).toHaveBeenCalledWith("docs/readme");
    // 지금 브랜치와는 비교할 수 없다.
    expect(within(row("fix/audit-bugs")).getByRole("button", { name: "비교" })).toHaveProperty("disabled", true);
  });

  it("shows the second line the mockup gives each section", () => {
    renderPanel();
    // 워크트리 칸: 기반 · 작성자
    expect(row("feat/review-stream").textContent).toContain("fix/audit-bugs에서 갈라짐 · Claude");
    expect(row("feat/review-stream").textContent).toContain("↑4");
    expect(row("main").textContent).toContain("기본 브랜치 · origin/main과 같음");
    // 로컬 칸: 기반 · 시각
    expect(row("docs/readme").textContent).toContain("main에서 갈라짐 (추정) · 26분 전");
    // merge로 들어간 브랜치는 시안 문구, 커밋 없이 뒤처지기만 한 브랜치는 그냥 갈라짐
    expect(row("fix/merged").textContent).toContain("fix/audit-bugs에 merge됨 · 정리 가능");
    expect(row("fix/idle").textContent).toContain("main에서 갈라짐 · 2시간 전");
    expect(row("fix/idle").textContent).not.toContain("merge됨");
    // 원격 칸: 원격에만 있음 · 시각
    expect(row("origin/feature/ai-commit").textContent).toContain("원격에만 있음 · 2주 전");
  });

  it("uses the mockup's 새 브랜치 label", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "새 브랜치" })).toBeTruthy();
  });

  it("asks bases only for local, non-default rows (no observer: the first rows)", () => {
    renderPanel();
    const asked = new Set(baseCalls.flat());
    expect(asked.has("main")).toBe(false);
    expect(asked.has("origin/feature/ai-commit")).toBe(false);
    expect(asked.has("docs/readme")).toBe(true);
  });

  it("asks bases only for rows the IntersectionObserver reports on screen", () => {
    const observed: Element[] = [];
    let report: ((entries: IntersectionObserverEntry[]) => void) | null = null;
    class FakeObserver {
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        report = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    try {
      renderPanel();
      // 아직 아무 행도 보이지 않았다.
      expect(baseCalls.flat()).toEqual([]);
      const visible = new Set(["feat/review-stream", "docs/readme"]);
      act(() =>
        report!(
          observed.map(
            (target) =>
              ({
                target,
                isIntersecting: visible.has((target as HTMLElement).dataset.branchName ?? ""),
              }) as unknown as IntersectionObserverEntry,
          ),
        ),
      );
      const asked = new Set(baseCalls.flat());
      expect([...asked].sort()).toEqual(["docs/readme", "feat/review-stream"]);
      expect(asked.has("fix/merged")).toBe(false);
      expect(asked.has("fix/idle")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sorts local branches by recent switch or by name, and collapses a section", () => {
    recentNames = ["fix/idle"];
    renderPanel();
    const localRows = () =>
      [...screen.getByRole("region", { name: "로컬" }).querySelectorAll("[data-branch-name]")].map((el) =>
        el.getAttribute("data-branch-name"),
      );
    // 최근에 전환한 브랜치 → 최근 커밋순
    expect(localRows()).toEqual(["fix/idle", "docs/readme", "fix/merged"]);
    fireEvent.click(screen.getByRole("button", { name: /최근순/ }));
    expect(localRows()).toEqual(["docs/readme", "fix/idle", "fix/merged"]);

    fireEvent.click(screen.getByRole("button", { name: "원격 · origin 접기" }));
    expect(document.querySelector('[data-branch-name="origin/feature/ai-commit"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "원격 · origin 펼치기" }));
    expect(document.querySelector('[data-branch-name="origin/feature/ai-commit"]')).not.toBeNull();
  });

  it("turns compare and merge off on a detached HEAD", () => {
    renderPanel(null);
    const docs = within(row("docs/readme"));
    expect(docs.getByRole("button", { name: "비교" })).toHaveProperty("disabled", true);
    expect(docs.getByRole("button", { name: "Merge…" })).toHaveProperty("disabled", true);
  });

  it("filters by the search text and opens the rename dialog from the context menu", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "브랜치 찾기" }), { target: { value: "readme" } });
    expect([...document.querySelectorAll("[data-branch-name]")].map((el) => el.getAttribute("data-branch-name"))).toEqual([
      "docs/readme",
    ]);
    fireEvent.contextMenu(row("docs/readme"));
    fireEvent.click(screen.getByText(i18n.t("branch.contextMenu.rename")));
    expect(handlers.onRename).toHaveBeenCalledWith("docs/readme");
  });
});
