// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  sanitizePreferences,
  usePreferencesStore,
} from "@/stores/preferences";

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
});

describe("sanitizePreferences", () => {
  it("keeps well-formed values", () => {
    expect(
      sanitizePreferences({
        defaultAutoSync: { mode: "pull", intervalMinutes: 10 },
        codeFontSize: 14,
        quietMinutes: 30,
        collapseQuietRepos: false,
        worktreeParentDir: " /Users/me/worktrees ",
      }),
    ).toEqual({
      defaultAutoSync: { mode: "pull", intervalMinutes: 10 },
      codeFontSize: 14,
      quietMinutes: 30,
      collapseQuietRepos: false,
      worktreeParentDir: "/Users/me/worktrees",
    });
  });

  it("drops values outside the offered choices so the defaults apply", () => {
    expect(
      sanitizePreferences({
        defaultAutoSync: { mode: "sometimes", intervalMinutes: 3 },
        codeFontSize: 40,
        quietMinutes: 7,
        collapseQuietRepos: "yes",
        worktreeParentDir: "  ",
      }),
    ).toEqual({});
    expect(sanitizePreferences(null)).toEqual({});
  });
});

describe("usePreferencesStore", () => {
  it("ignores a bad patch and keeps the current value", () => {
    usePreferencesStore.getState().setPreferences({ codeFontSize: 99 });
    expect(usePreferencesStore.getState().codeFontSize).toBe(DEFAULT_PREFERENCES.codeFontSize);
  });

  it("clears the worktree folder back to the default and saves the change", () => {
    const { setPreferences } = usePreferencesStore.getState();
    setPreferences({ worktreeParentDir: "/tmp/wt" });
    expect(usePreferencesStore.getState().worktreeParentDir).toBe("/tmp/wt");
    setPreferences({ worktreeParentDir: null });
    expect(usePreferencesStore.getState().worktreeParentDir).toBeNull();
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}");
    expect(saved.version).toBe(0);
    expect(saved.state.worktreeParentDir).toBeNull();
    expect(saved.state).not.toHaveProperty("setPreferences");
  });
});
