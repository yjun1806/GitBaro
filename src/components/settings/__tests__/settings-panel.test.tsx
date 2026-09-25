// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import type { AppSettings } from "@/types";

vi.mock("@/api/commands", () => ({
  detectInstalledEditors: vi.fn(async () => [
    { id: "vscode", name: "Visual Studio Code", command: "code", installed: true, icon: null },
    { id: "zed", name: "Zed", command: "zed", installed: true, icon: null },
  ]),
  detectInstalledTerminals: vi.fn(async () => [{ id: "terminal", name: "Terminal", installed: true, icon: null }]),
  detectInstalledAiClis: vi.fn(async () => [{ id: "claude", name: "Claude Code", command: "claude", installed: true }]),
  getAppVersion: vi.fn(async () => "0.1.7"),
  getEnvironmentInfo: vi.fn(async () => ({
    settingsPath: "/Users/me/Library/Application Support/com.gitbaro.app/settings.json",
    gitPath: "/usr/bin/git",
    gitVersion: "2.43.0",
    ghPath: null,
    ghVersion: null,
  })),
  revealInFinder: vi.fn(async () => {}),
  openInTerminal: vi.fn(async () => {}),
  openRepoInEditor: vi.fn(async () => {}),
  openInEditor: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/Users/me/wt") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/notify/deliver", () => ({ deliverNotification: vi.fn(async () => "system") }));

const { SettingsPanel } = await import("../SettingsPanel");
const { usePreferencesStore, DEFAULT_PREFERENCES } = await import("@/stores/preferences");
const { useUIStore } = await import("@/stores/ui");

const settings: AppSettings = {
  theme: "light",
  language: "en",
  defaultEditor: "vscode",
  defaultShell: "terminal",
  defaultAiCli: "claude",
  notifications: { newCommits: true, ciFailures: true, whenFocused: false },
};

function renderPanel(initialSection?: Parameters<typeof SettingsPanel>[0]["initialSection"]) {
  const onUpdateSettings = vi.fn();
  const onClose = vi.fn();
  render(
    <SettingsPanel
      settings={settings}
      accounts={[{ id: "a1", username: "octo", email: "octo@example.com", avatarUrl: "" }]}
      onUpdateSettings={onUpdateSettings}
      onRemoveAccount={vi.fn()}
      onAddAccount={vi.fn()}
      onSyncAccounts={vi.fn(async () => {})}
      onClose={onClose}
      initialSection={initialSection}
    />,
  );
  return { onUpdateSettings, onClose };
}

const nav = () => screen.getByRole("navigation", { name: "Settings" });
const goTo = (label: string) => fireEvent.click(within(nav()).getByRole("button", { name: label }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  useUIStore.setState({ diffLineMode: "unified" });
});
afterEach(cleanup);

describe("SettingsPanel", () => {
  it("lists every section on the left and opens General first", () => {
    renderPanel();
    expect(within(nav()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "General",
      "Appearance",
      "Accounts",
      "Editor & terminal",
      "Notifications",
      "Sync",
      "About",
    ]);
    expect(within(nav()).getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
  });

  it("closes on Escape", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("changes language, and folds quiet repositories only while the switch is on", () => {
    const { onUpdateSettings } = renderPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "ko" } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ language: "ko" });

    const fold = screen.getByRole("switch", { name: "Fold quiet repositories" });
    expect(fold).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "Quiet after" }), { target: { value: "30" } });
    expect(usePreferencesStore.getState().quietMinutes).toBe(30);

    fireEvent.click(fold);
    expect(usePreferencesStore.getState().collapseQuietRepos).toBe(false);
    expect(screen.getByRole("combobox", { name: "Quiet after" })).toBeDisabled();
  });

  it("picks a folder for new worktrees and can go back to the default", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText("/Users/me/wt")).toBeInTheDocument();
    expect(usePreferencesStore.getState().worktreeParentDir).toBe("/Users/me/wt");
    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    expect(usePreferencesStore.getState().worktreeParentDir).toBeNull();
  });

  it("sets theme, diff layout and code font size from Appearance", () => {
    const { onUpdateSettings } = renderPanel();
    goTo("Appearance");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ theme: "dark" });
    fireEvent.click(screen.getByRole("radio", { name: "Side by Side" }));
    expect(useUIStore.getState().diffLineMode).toBe("split");
    fireEvent.click(screen.getByRole("radio", { name: "14" }));
    expect(usePreferencesStore.getState().codeFontSize).toBe(14);
  });

  it("moves between choices with the arrow keys", () => {
    renderPanel("appearance");
    const light = screen.getByRole("radio", { name: "Light" });
    // 고르지 않은 선택지는 Tab 순서에서 빠진다.
    expect(light).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("tabindex", "-1");
  });

  it("chooses the default editor among the detected ones", async () => {
    const { onUpdateSettings } = renderPanel("tools");
    const zed = await screen.findByRole("radio", { name: "Zed" });
    expect(screen.getByRole("radio", { name: "Visual Studio Code" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(zed);
    expect(onUpdateSettings).toHaveBeenCalledWith({ defaultEditor: "zed" });
  });

  it("turns a notification kind off right away", () => {
    const { onUpdateSettings } = renderPanel("notifications");
    fireEvent.click(screen.getByRole("switch", { name: "New commits" }));
    expect(onUpdateSettings).toHaveBeenCalledWith({
      notifications: { newCommits: false, ciFailures: true, whenFocused: false },
    });
  });

  it("sets the default remote auto sync used by repositories without their own", () => {
    renderPanel("sync");
    fireEvent.click(screen.getByRole("radio", { name: "Pull automatically" }));
    expect(usePreferencesStore.getState().defaultAutoSync.mode).toBe("pull");
    // 받기를 고르면 언제 받는지 알린다.
    expect(screen.getByText(/Pulls only when/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Check every" }), { target: { value: "10" } });
    expect(usePreferencesStore.getState().defaultAutoSync).toEqual({ mode: "pull", intervalMinutes: 10 });
  });

  it("shows the app version and the git and gh it found", async () => {
    renderPanel("about");
    expect(await screen.findByText("0.1.7")).toBeInTheDocument();
    expect(await screen.findByText("2.43.0")).toBeInTheDocument();
    expect(screen.getByText("/usr/bin/git")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in Finder" })).toBeEnabled();
  });

  it("opens on the section it was asked for", () => {
    renderPanel("accounts");
    expect(screen.getByText("octo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
  });
});
