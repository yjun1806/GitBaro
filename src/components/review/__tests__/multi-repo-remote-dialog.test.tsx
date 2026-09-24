// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import type { RepoRemotePlan } from "@/types";

const commands = vi.hoisted(() => ({
  gitFetch: vi.fn((_path: string, _account: string) => Promise.resolve()),
  gitPull: vi.fn((_path: string, _account: string) => Promise.resolve()),
  gitPush: vi.fn((_path: string, _account: string, _force?: boolean) => Promise.resolve()),
  planRemoteOp: vi.fn((_paths: string[], _op: string) => Promise.resolve([] as unknown[])),
}));
vi.mock("@/api/commands", () => commands);
vi.mock("@/api/queries", () => ({ invalidateAfterSync: () => Promise.resolve() }));

import { useRepositoryStore } from "@/stores/repository";
import { useSyncStore } from "@/stores/sync";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const { MultiRepoRemoteDialog } = await import("@/components/review/MultiRepoRemoteDialog");

const repos = ["xames-backend", "xames-app", "xames-admin", "xames-design"].map((name) =>
  makeRepo(name, "mos", { accountId: "mos-bot" }),
);
const paths = repos.map((r) => r.path);

function plan(name: string, overrides: Partial<RepoRemotePlan>): RepoRemotePlan {
  return {
    path: `/repos/${name}`,
    branch: "feat/notification-settings",
    remote: "origin",
    command: "git push origin feat/notification-settings",
    commits: 2,
    behind: 0,
    needsPull: false,
    setsUpstream: false,
    skip: false,
    skipReason: null,
    fetchedAt: Math.floor(Date.now() / 1000) - 300,
    error: null,
    ...overrides,
  };
}

const PUSH_PLANS = [
  plan("xames-backend", {}),
  plan("xames-app", { commits: 15, behind: 1, needsPull: true }),
  plan("xames-admin", { command: "git push -u origin feat/notification-settings", setsUpstream: true }),
  plan("xames-design", { command: "git push origin feat/noti-tokens", commits: 0, skip: true, skipReason: "upToDate" }),
];

function renderDialog(op: "fetch" | "pull" | "push" = "push", onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MultiRepoRemoteDialog paths={paths} op={op} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  Object.values(commands).forEach((fn) => fn.mockClear());
  commands.gitFetch.mockImplementation(() => Promise.resolve());
  commands.gitPush.mockImplementation(() => Promise.resolve());
  commands.planRemoteOp.mockImplementation(() => Promise.resolve(PUSH_PLANS));
  useRepositoryStore.setState({ repos, activeRepoPath: null, activeRepo: null });
  useSyncStore.setState({ syncingByRepo: {}, lastFetchedByRepo: {} });
});

afterEach(cleanup);

describe("MultiRepoRemoteDialog", () => {
  it("fetches every repository first, then shows each repository's own command", async () => {
    renderDialog();
    expect(await screen.findByText("git push -u origin feat/notification-settings")).toBeTruthy();
    expect(commands.gitFetch).toHaveBeenCalledTimes(4);
    const fetchOrder = commands.gitFetch.mock.invocationCallOrder[3];
    expect(fetchOrder).toBeLessThan(commands.planRemoteOp.mock.invocationCallOrder[0]);
    expect(screen.getByText("git push origin feat/noti-tokens")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Push in each of 3 repositories" })).toBeTruthy();
    // 아직 아무것도 올리지 않았다.
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("unchecks and dims a repository with nothing to push", async () => {
    renderDialog();
    const row = await screen.findByTestId("plan-row-xames-design");
    expect(row.getAttribute("data-skipped")).toBe("true");
    const box = within(row).getByRole("checkbox", { name: "xames-design" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(within(row).getByText("Nothing to push")).toBeTruthy();
  });

  it("warns ahead about a needed pull and a new upstream (-u)", async () => {
    renderDialog();
    expect(await screen.findByText(/xames-app has 1 new commit on the remote/)).toBeTruthy();
    expect(screen.getByText(/xames-admin will be linked to a new remote branch \(-u\)/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Pull xames-app first, then push" })).toBeTruthy();
  });

  it("labels a repository whose fetch failed as planned from the last fetch", async () => {
    commands.gitFetch.mockImplementation((path: string) =>
      path === "/repos/xames-app" ? Promise.reject(new Error("offline")) : Promise.resolve(),
    );
    renderDialog();
    const row = await screen.findByTestId("plan-row-xames-app");
    expect(within(row).getByTestId("stale-fetch").textContent).toMatch(/^As of last fetch · /);
    expect(screen.queryAllByTestId("stale-fetch")).toHaveLength(1);
    expect(screen.getByText(/xames-app couldn't fetch/)).toBeTruthy();
  });

  it("dates the stale label by the last successful fetch when the failed fetch left no time", async () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 3600;
    useSyncStore.setState({ lastFetchedByRepo: { "/repos/xames-app": twoHoursAgo } });
    commands.gitFetch.mockImplementation((path: string) =>
      path === "/repos/xames-app" ? Promise.reject(new Error("offline")) : Promise.resolve(),
    );
    commands.planRemoteOp.mockImplementation(() =>
      Promise.resolve(PUSH_PLANS.map((p) => (p.path === "/repos/xames-app" ? { ...p, fetchedAt: null } : p))),
    );
    renderDialog();
    const row = await screen.findByTestId("plan-row-xames-app");
    const label = within(row).getByTestId("stale-fetch").textContent ?? "";
    expect(label).toMatch(/^As of last fetch · /);
    expect(label).not.toMatch(/unknown/);
  });

  it("lets the user pull a 'nothing to pull' repository whose fetch failed", async () => {
    commands.gitFetch.mockImplementation((path: string) =>
      path === "/repos/xames-app" ? Promise.reject(new Error("offline")) : Promise.resolve(),
    );
    commands.planRemoteOp.mockImplementation(() =>
      Promise.resolve(
        paths.map((p) =>
          plan(p.split("/").pop() ?? p, {
            command: "git pull --no-rebase origin refs/heads/main",
            commits: 0,
            skip: true,
            skipReason: "upToDate",
          }),
        ),
      ),
    );
    renderDialog("pull");
    const row = await screen.findByTestId("plan-row-xames-app");
    const box = within(row).getByRole("checkbox", { name: "xames-app" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect(screen.getByText(/xames-app couldn't fetch, so “Nothing to pull” may be out of date/)).toBeTruthy();
    const fresh = within(screen.getByTestId("plan-row-xames-backend")).getByRole("checkbox", {
      name: "xames-backend",
    }) as HTMLInputElement;
    expect(fresh.disabled).toBe(true);

    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Pull 1 repository" }));
    await waitFor(() => expect(commands.gitPull).toHaveBeenCalledTimes(1));
    expect(commands.gitPull.mock.calls[0][0]).toBe("/repos/xames-app");
  });

  it("translates remote-selection error codes like the single-repository toolbar", async () => {
    commands.gitPush.mockImplementation((path: string) =>
      path === "/repos/xames-app"
        ? Promise.reject({ type: "GitCli", message: "detached_head" })
        : path === "/repos/xames-admin"
          ? Promise.reject({ type: "GitCli", message: "no_upstream:feat/x" })
          : Promise.resolve(),
    );
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Push 3 repositories" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 succeeded · 2 failed"));
    expect(within(screen.getByTestId("plan-row-xames-app")).getByText(/HEAD is detached/)).toBeTruthy();
    expect(within(screen.getByTestId("plan-row-xames-admin")).getByText(/This branch has no upstream/)).toBeTruthy();
    expect(screen.queryByText("detached_head")).toBeNull();
  });

  it("pushes each checked repository separately and shows per-repository results", async () => {
    commands.gitPush.mockImplementation((path: string) =>
      path === "/repos/xames-app" ? Promise.reject({ type: "GitCli", message: "rejected: fetch first" }) : Promise.resolve(),
    );
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Push 3 repositories" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 succeeded · 1 failed"));
    expect(commands.gitPush.mock.calls).toEqual([
      ["/repos/xames-backend", "mos-bot", false],
      ["/repos/xames-app", "mos-bot", false],
      ["/repos/xames-admin", "mos-bot", false],
    ]);
    const app = screen.getByTestId("plan-row-xames-app");
    expect(within(app).getByText("rejected: fetch first")).toBeTruthy();
    expect(within(screen.getByTestId("plan-row-xames-admin")).getByText("Done")).toBeTruthy();
  });

  it("leaves out a repository the user unchecks", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox", { name: "xames-backend" }));
    fireEvent.click(screen.getByRole("button", { name: "Push 2 repositories" }));
    await waitFor(() => expect(commands.gitPush).toHaveBeenCalledTimes(2));
    expect(commands.gitPush.mock.calls.map((c) => c[0])).toEqual(["/repos/xames-app", "/repos/xames-admin"]);
  });

  it("does not claim to fetch while preparing a Fetch", async () => {
    await i18n.changeLanguage("ko");
    commands.planRemoteOp.mockImplementation(() => new Promise(() => {}));
    renderDialog("fetch");
    expect(screen.getByText("저장소마다 실행할 내용을 확인하는 중…")).toBeTruthy();
    expect(screen.queryByText(/fetch해서/)).toBeNull();
  });

  it("does not fetch ahead of a Fetch and shows the Korean copy", async () => {
    await i18n.changeLanguage("ko");
    commands.planRemoteOp.mockImplementation(() =>
      Promise.resolve(paths.map((p) => plan(p.split("/").pop() ?? p, { command: "git fetch --prune origin", commits: 0 }))),
    );
    renderDialog("fetch");
    expect(await screen.findByRole("button", { name: "4곳 Fetch" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "저장소 4곳에서 각각 Fetch" })).toBeTruthy();
    expect(commands.gitFetch).not.toHaveBeenCalled();
  });
});
