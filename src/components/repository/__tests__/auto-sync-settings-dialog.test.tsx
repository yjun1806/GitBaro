// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/i18n/config";
import { AutoSyncSettingsDialog } from "@/components/repository/AutoSyncSettingsDialog";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoInfo } from "@/types";

const repo: RepoInfo = {
  path: "/work/app",
  name: "app",
  currentBranch: "main",
  isDirty: false,
  remotes: [{ name: "origin", url: "https://github.com/o/app.git" }],
  accountId: "acc",
};

beforeEach(() => {
  useRepositoryStore.setState({ repos: [repo], autoSyncByRepo: {} });
});

afterEach(cleanup);

describe("AutoSyncSettingsDialog", () => {
  it("starts from the default (check only) and saves the chosen mode for this repository", () => {
    const onClose = vi.fn();
    render(<AutoSyncSettingsDialog repo={repo} onClose={onClose} />);

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ["off", false],
      ["fetch", true],
      ["pull", false],
    ]);

    fireEvent.click(radios[2]);
    fireEvent.click(screen.getByText("Save"));

    expect(useRepositoryStore.getState().autoSyncByRepo).toEqual({
      "/work/app": { mode: "pull", intervalMinutes: 3 },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves the setting unchanged when cancelled", () => {
    render(<AutoSyncSettingsDialog repo={repo} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(useRepositoryStore.getState().autoSyncByRepo).toEqual({});
  });
});
