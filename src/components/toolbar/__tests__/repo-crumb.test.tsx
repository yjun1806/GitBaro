// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoSettingsStore } from "@/stores/repo-settings";
import { RepoCrumb } from "../RepoCrumb";
import type { RepoInfo } from "@/types";

const APP = "/work/app";
const app: RepoInfo = {
  path: APP,
  name: "app",
  currentBranch: "main",
  isDirty: false,
  remotes: [],
  accountId: null,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useRepositoryStore.setState({ repos: [app], activeRepo: app, activeRepoPath: APP, repoPrefs: {} });
  useRepoSettingsStore.setState({ repoPath: null, section: "name" });
});
afterEach(cleanup);

describe("RepoCrumb", () => {
  it("shows the folder name, or the display name once one is set", () => {
    const { rerender } = render(<RepoCrumb />);
    expect(screen.getByTestId("repo-crumb")).toHaveTextContent("app");
    useRepositoryStore.setState({ repoPrefs: { [APP]: { alias: "Shop" } } });
    rerender(<RepoCrumb />);
    expect(screen.getByTestId("repo-crumb")).toHaveTextContent("Shop");
    expect(screen.getByTestId("repo-crumb")).not.toHaveTextContent("app");
  });

  it("opens the repository settings when clicked", () => {
    render(<RepoCrumb />);
    const crumb = screen.getByRole("button", { name: "app · Repository settings" });
    fireEvent.click(crumb);
    expect(useRepoSettingsStore.getState()).toMatchObject({ repoPath: APP, section: "name" });
  });
});
