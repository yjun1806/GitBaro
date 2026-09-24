// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { BranchInfo, StatusEntry } from "@/types";
import { countUncommitted, gitStatusLine, type GitStatusInput } from "../git-status-line";
import { GitStatusLineView, checkoutNameFor, remoteOpFor } from "../GitStatusLine";

const t = i18n.t.bind(i18n);

function input(extra: Partial<GitStatusInput> = {}): GitStatusInput {
  return {
    worktree: { isMain: true, name: "app" },
    branch: "main",
    headSha: "abc1234def",
    upstream: { name: "origin/main", ahead: 2, behind: 1 },
    hasRemote: true,
    uncommitted: { total: 3, staged: 1, conflicts: 0 },
    operation: null,
    viewing: null,
    ...extra,
  };
}

const handlers = { onCheckout: vi.fn(), onBack: vi.fn(), onRemote: vi.fn() };

function renderLine(data: GitStatusInput, withRemote = true) {
  const model = gitStatusLine(data, t);
  render(
    <GitStatusLineView
      model={model}
      uncommittedCount={data.uncommitted.total}
      checkoutName={data.viewing?.kind === "ref" ? data.viewing.name : null}
      onCheckout={handlers.onCheckout}
      onBack={handlers.onBack}
      onRemote={withRemote ? handlers.onRemote : undefined}
    />,
  );
  return screen.getByRole("status");
}

beforeEach(async () => {
  await i18n.changeLanguage("ko");
  Object.values(handlers).forEach((h) => h.mockReset());
});
afterEach(cleanup);

describe("git status line", () => {
  it("normal: work tree · checkout · upstream · uncommitted, with Commit", () => {
    const line = renderLine(input());
    expect(line.dataset.tone).toBe("normal");
    expect(line.textContent).toBe(
      "메인 작업 트리·체크아웃 ⎇ main·origin/main보다 ↑2 ↓1·커밋 안 한 변경 3개 (스테이징 1)커밋하기 (3)",
    );
    fireEvent.click(screen.getByRole("button", { name: "origin/main보다 ↑2 ↓1" }));
    expect(handlers.onRemote).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "커밋하기 (3)" })).toBeTruthy();
  });

  it("normal in a linked worktree without an upstream and without changes", () => {
    const line = renderLine(
      input({
        worktree: { isMain: false, name: "app-feat" },
        branch: "feat/x",
        upstream: null,
        uncommitted: { total: 0, staged: 0, conflicts: 0 },
      }),
    );
    expect(line.textContent).toBe("작업 트리 app-feat·체크아웃 ⎇ feat/x·원격 브랜치 없음·커밋 안 한 변경 없음");
    expect(screen.queryByRole("button", { name: /커밋하기/ })).toBeNull();
  });

  it("detached HEAD: warns and names the commit instead of a branch", () => {
    const line = renderLine(input({ branch: null, uncommitted: { total: 0, staged: 0, conflicts: 0 } }));
    expect(line.dataset.tone).toBe("detached");
    expect(line.textContent).toContain("분리된 HEAD");
    expect(line.textContent).toContain("브랜치 없음 · abc1234");
    // 브랜치가 없으니 upstream도 없다.
    expect(line.textContent).not.toContain("origin/main");
  });

  it("merging: says what is in progress and how many conflicts are left", () => {
    const entries = [
      { path: "a.ts", status: "conflicted", staged: false },
      { path: "b.ts", status: "conflicted", staged: false },
      { path: "c.ts", status: "modified", staged: true },
      { path: "c.ts", status: "modified", staged: false },
    ] as StatusEntry[];
    const line = renderLine(input({ operation: "merge", uncommitted: countUncommitted(entries) }));
    expect(line.dataset.tone).toBe("operation");
    expect(line.textContent).toContain("merge 진행 중 · 충돌 2개");
    expect(line.textContent).toContain("커밋 안 한 변경 3개 (스테이징 1)");
    // 진행 중에는 push/pull을 권하지 않는다.
    expect(line.textContent).not.toContain("origin/main보다");

    cleanup();
    expect(renderLine(input({ operation: "rebase" })).textContent).toContain("rebase 진행 중");
  });

  it("viewing: the line is the strip, with checkout and back buttons", () => {
    const line = renderLine(input({ viewing: { kind: "ref", name: "feat/x", isRemote: false } }));
    expect(line.dataset.tone).toBe("viewing");
    expect(line.textContent).toContain("feat/x 보는 중 · 체크아웃 안 함");
    // 무엇이 실제로 체크아웃돼 있는지는 그대로 보인다.
    expect(line.textContent).toContain("체크아웃 ⎇ main");
    // 커밋 안 한 변경·커밋하기·upstream은 보는 중에는 없다.
    expect(line.textContent).not.toContain("커밋 안 한 변경");
    expect(screen.queryByRole("button", { name: /커밋하기/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이 브랜치로 체크아웃" }));
    expect(handlers.onCheckout).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "현재 브랜치로 돌아가기" }));
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it("viewing all branches offers no checkout", () => {
    const line = renderLine(input({ viewing: { kind: "all" } }));
    expect(line.textContent).toContain("모든 브랜치 보는 중 · 체크아웃 안 함");
    expect(screen.queryByRole("button", { name: "이 브랜치로 체크아웃" })).toBeNull();
  });

  it("uses English terms too", async () => {
    await i18n.changeLanguage("en");
    const line = renderLine(input());
    expect(line.textContent).toContain("Main working tree");
    expect(line.textContent).toContain("Checked out ⎇ main");
    expect(line.textContent).toContain("↑2 ↓1 vs origin/main");
    expect(line.textContent).toContain("3 uncommitted changes (1 staged)");
  });
});

describe("status line helpers", () => {
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

  it("checks out the local branch that tracks a viewed remote branch, else the remote itself", () => {
    const branches = [branch("x", { upstream: "origin/x" }), branch("origin/x", { isRemote: true })];
    expect(checkoutNameFor({ kind: "ref", name: "origin/x", isRemote: true }, branches)).toBe("x");
    expect(checkoutNameFor({ kind: "ref", name: "origin/y", isRemote: true }, branches)).toBe("origin/y");
    expect(checkoutNameFor({ kind: "ref", name: "feat", isRemote: false }, branches)).toBe("feat");
    expect(checkoutNameFor({ kind: "all" }, branches)).toBeNull();
  });

  it("opens pull when behind, push when ahead or unpublished, nothing when in sync", () => {
    const up = (ahead: number, behind: number, hasUpstream = true) => ({ text: "", ahead, behind, hasUpstream });
    expect(remoteOpFor(up(1, 2))).toBe("pull");
    expect(remoteOpFor(up(1, 0))).toBe("push");
    expect(remoteOpFor(up(0, 0, false))).toBe("push");
    expect(remoteOpFor(up(0, 0))).toBeNull();
  });
});
