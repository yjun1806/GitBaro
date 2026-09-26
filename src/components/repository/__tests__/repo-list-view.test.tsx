// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import type { RepoInfo } from "@/types";

const invoke = vi.fn(async (...args: unknown[]) => {
  // react-query 쿼리는 undefined를 못 받는다 — 이 테스트가 안 보는 조회는 빈 배열로 채운다.
  if (args[0] === "repo_sync_status") return [];
  return undefined as unknown;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false), open: vi.fn(async () => null) }));

const { RepoListView } = await import("../RepoListView");

const LOCAL = "/local/no-remote";
const PUBLIC = "/repos/webapp";

function repo(path: string, remotes: RepoInfo["remotes"]): RepoInfo {
  return {
    path,
    name: path.split("/").pop()!,
    currentBranch: "main",
    isDirty: false,
    remotes,
    accountId: remotes.length > 0 ? "acc1" : null,
  } as RepoInfo;
}

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoListView onSelectRepo={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  useRepositoryStore.setState({
    repos: [repo(LOCAL, []), repo(PUBLIC, [{ name: "origin", url: "https://github.com/acme/webapp.git" }])],
    favoriteRepos: [],
    collapsedGroups: [],
    // 미리 채워 두면 getRepoVisibility/getOwnerType effect가 다시 invoke하지 않는다 — 이 테스트는
    // 아이콘 렌더링만 본다.
    repoVisibility: { [PUBLIC]: { isPrivate: false, isFork: false, isArchived: false, ownerType: "User" } },
    ownerTypes: { acme: "User" },
  });
  useAccountStore.setState({ accounts: [{ id: "acc1", username: "acme" }] as never });
});
afterEach(cleanup);

describe("RepoListView repo icons", () => {
  // D-low #9: 마이그레이션 전에는 각 줄에 로컬 전용(HardDrive)/공개(Globe) 구분이 있었는데
  // 사라졌었다. 이름 옆에 title이 붙은 아이콘으로 되돌린다.
  it("marks a repository with no remote as local-only, with an accessible title", () => {
    renderList();
    const localRow = screen.getByText("no-remote").closest("button")!;
    const icon = localRow.querySelector('[title="Local only — no remote"]');
    expect(icon).toBeTruthy();
  });

  it("marks a repository with a public remote as public, with an accessible title", () => {
    renderList();
    const publicRow = screen.getByText("webapp").closest("button")!;
    const icon = publicRow.querySelector('[title="Public repository"]');
    expect(icon).toBeTruthy();
  });
});
