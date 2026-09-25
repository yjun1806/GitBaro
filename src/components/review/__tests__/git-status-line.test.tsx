// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { BranchInfo, StatusEntry } from "@/types";
import { countConflicts, gitStatusLine, type GitStatusInput } from "../git-status-line";
import { GitStatusLineView, checkoutNameFor, remoteOpFor } from "../GitStatusLine";

const t = i18n.t.bind(i18n);

function input(extra: Partial<GitStatusInput> = {}): GitStatusInput {
  return {
    worktree: { isMain: true, name: "app" },
    branch: "main",
    headSha: "abc1234def",
    upstream: { name: "origin/main", ahead: 2, behind: 1 },
    unpushed: 2,
    hasRemote: true,
    conflicts: 0,
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
  it("normal: work tree · checkout · upstream state, with no counts", () => {
    const line = renderLine(input());
    expect(line.dataset.tone).toBe("normal");
    // 수는 사이드바·WIP 행·Push·Pull 버튼이 말한다. 이 줄은 상태만 말한다.
    expect(line.textContent).toBe("기본 폴더·체크아웃 ⎇ main·원격에 없는 커밋 있음 · 받을 커밋 있음");
    expect(line.textContent).not.toMatch(/\d/);
    const remote = screen.getByRole("button", { name: "원격에 없는 커밋 있음 · 받을 커밋 있음" });
    expect(remote.getAttribute("title")).toBe("origin/main");
    fireEvent.click(remote);
    expect(handlers.onRemote).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^작업 중인 변경/ })).toBeNull();
  });

  it("normal in a linked worktree without an upstream and without changes", () => {
    const line = renderLine(
      input({
        worktree: { isMain: false, name: "app-feat" },
        branch: "feat/x",
        upstream: null,
        unpushed: 0,
      }),
    );
    expect(line.textContent).toBe("작업 트리 app-feat·체크아웃 ⎇ feat/x·publish 전");
  });

  it("detached HEAD: warns and names the commit instead of a branch", () => {
    const line = renderLine(input({ branch: null }));
    expect(line.dataset.tone).toBe("detached");
    expect(line.textContent).toContain("분리된 HEAD");
    expect(line.textContent).toContain("브랜치 없음 · abc1234");
    // 브랜치가 없으니 upstream도 없다.
    expect(line.textContent).not.toContain("원격에 없는 커밋");
  });

  it("says there are commits on no remote before the branch is published", () => {
    const line = renderLine(input({ branch: "feat/x", upstream: null, unpushed: 3 }));
    expect(line.textContent).toContain("원격에 없는 커밋 있음 · publish 전");
  });

  it("says the branch matches the remote when there is nothing to push or pull", () => {
    const line = renderLine(input({ upstream: { name: "origin/main", ahead: 0, behind: 0 }, unpushed: 0 }));
    expect(line.textContent).toContain("원격과 같음");
  });

  it("merging: says what is in progress and how many conflicts are left", () => {
    const entries = [
      { path: "a.ts", status: "conflicted", staged: false },
      { path: "b.ts", status: "conflicted", staged: false },
      { path: "c.ts", status: "modified", staged: true },
      { path: "c.ts", status: "modified", staged: false },
    ] as StatusEntry[];
    const line = renderLine(input({ operation: "merge", conflicts: countConflicts(entries) }));
    expect(line.dataset.tone).toBe("operation");
    expect(line.textContent).toContain("merge 진행 중 · 충돌 2개");
    // 진행 중에는 push/pull을 권하지 않는다.
    expect(line.textContent).not.toContain("원격에 없는 커밋");

    cleanup();
    expect(renderLine(input({ operation: "rebase" })).textContent).toContain("rebase 진행 중");
  });

  it("viewing: the line is the strip, with checkout and back buttons", () => {
    const line = renderLine(input({ viewing: { kind: "ref", name: "feat/x", isRemote: false } }));
    expect(line.dataset.tone).toBe("viewing");
    expect(line.textContent).toContain("feat/x 보는 중 · 체크아웃 안 함");
    // 무엇이 실제로 체크아웃돼 있는지는 그대로 보인다.
    expect(line.textContent).toContain("체크아웃 ⎇ main");
    // upstream은 보는 중에는 없다.
    expect(line.textContent).not.toContain("원격에 없는 커밋");
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
    expect(line.textContent).toContain("Primary folder");
    expect(line.textContent).toContain("Checked out ⎇ main");
    expect(line.textContent).toContain("Commits not on any remote · Commits to pull");
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
    const up = (ahead: number, behind: number, hasUpstream = true) => ({ text: "", title: "", ahead, behind, hasUpstream });
    expect(remoteOpFor(up(1, 2))).toBe("pull");
    expect(remoteOpFor(up(1, 0))).toBe("push");
    expect(remoteOpFor(up(0, 0, false))).toBe("push");
    expect(remoteOpFor(up(0, 0))).toBeNull();
  });
});
