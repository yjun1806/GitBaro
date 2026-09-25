// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  REPOS_STORAGE_KEY,
  REPOS_STORAGE_VERSION,
  sanitizeRepositoryState,
  useRepositoryStore,
} from "@/stores/repository";
import { AVATAR_HUES } from "@/lib/avatar-color";
import type { RepoInfo } from "@/types";

const APP = "/work/app";
const API = "/work/api";

function repo(path: string): RepoInfo {
  return { path, name: path.split("/").pop()!, currentBranch: "main", isDirty: false, remotes: [], accountId: null };
}

beforeEach(() => {
  useRepositoryStore.setState({
    repos: [repo(APP), repo(API)],
    activeRepoPath: null,
    activeRepo: null,
    favoriteRepos: [APP],
    activeWorktrees: {},
    autoSyncByRepo: { [APP]: { mode: "pull", intervalMinutes: 5 } },
    repoPrefs: {},
  });
});

describe("repository store — per-repository preferences", () => {
  it("saves a display name and color without touching other fields", () => {
    useRepositoryStore.getState().updateRepoPrefs(APP, { alias: " Shop ", hue: AVATAR_HUES[1] });
    const state = useRepositoryStore.getState();
    expect(state.repoPrefs).toEqual({ [APP]: { alias: "Shop", hue: AVATAR_HUES[1] } });
    expect(state.favoriteRepos).toEqual([APP]);
    expect(state.autoSyncByRepo[APP]).toEqual({ mode: "pull", intervalMinutes: 5 });
  });

  it("goes back to the folder name when the display name is cleared", () => {
    const { updateRepoPrefs } = useRepositoryStore.getState();
    updateRepoPrefs(APP, { alias: "Shop" });
    updateRepoPrefs(APP, { alias: undefined });
    expect(useRepositoryStore.getState().repoPrefs).toEqual({});
  });

  it("forgets a repository's preferences when it is removed from the list, and keeps the others", () => {
    const { updateRepoPrefs, removeRepo } = useRepositoryStore.getState();
    updateRepoPrefs(APP, { alias: "Shop" });
    updateRepoPrefs(API, { alias: "Backend" });
    removeRepo(APP);
    expect(useRepositoryStore.getState().repoPrefs).toEqual({ [API]: { alias: "Backend" } });
  });

  it("resets auto sync to the app default", () => {
    useRepositoryStore.getState().resetAutoSync(APP);
    expect(useRepositoryStore.getState().autoSyncByRepo).toEqual({});
  });

  it("persists the preferences with the other fields at the same storage version", () => {
    useRepositoryStore.getState().updateRepoPrefs(APP, { alias: "Shop" });
    const saved = JSON.parse(localStorage.getItem(REPOS_STORAGE_KEY) ?? "{}");
    expect(saved.version).toBe(REPOS_STORAGE_VERSION);
    expect(REPOS_STORAGE_VERSION).toBe(0);
    expect(saved.state.repoPrefs).toEqual({ [APP]: { alias: "Shop" } });
    expect(saved.state.favoriteRepos).toEqual([APP]);
  });
});

describe("sanitizeRepositoryState — repoPrefs", () => {
  it("reads saved preferences and cleans broken entries", () => {
    const out = sanitizeRepositoryState({
      favoriteRepos: [APP],
      repoPrefs: { [APP]: { alias: "Shop", hue: 7 }, [API]: "broken" },
    });
    expect(out.repoPrefs).toEqual({ [APP]: { alias: "Shop" } });
    expect(out.favoriteRepos).toEqual([APP]);
  });

  it("leaves the field out for values saved before it existed, so the default applies", () => {
    const out = sanitizeRepositoryState({ favoriteRepos: [APP] });
    expect("repoPrefs" in out).toBe(false);
    expect(out.favoriteRepos).toEqual([APP]);
  });

  it("drops a broken field without wiping the rest", () => {
    const out = sanitizeRepositoryState({ repos: [repo(APP)], repoPrefs: "oops" });
    expect(out.repoPrefs).toEqual({});
    expect(out.repos).toHaveLength(1);
  });
});
