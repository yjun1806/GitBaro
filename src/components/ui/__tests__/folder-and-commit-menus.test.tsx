// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { CommitInfo } from "@/types";

const invoke = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

const { useFolderMenu } = await import("../useFolderMenu");
const { CommitContextMenu } = await import("@/components/history/CommitContextMenu");

const writeText = vi.fn(async (_text: string) => {});
beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  openUrl.mockClear();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

function FolderHost() {
  const menu = useFolderMenu();
  return (
    <>
      <button type="button" onClick={() => menu.open({ path: "/r/app", branch: "main" }, { x: 0, y: 0 })}>
        open
      </button>
      {menu.element}
    </>
  );
}

describe("useFolderMenu", () => {
  it("opens the folder in Finder, Terminal and the editor, and copies path and branch", () => {
    render(<FolderHost />);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Reveal in Finder",
      "Open in Terminal",
      "Open in editor",
      "Copy path",
      i18n.t("branch.contextMenu.copyName"),
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(invoke).toHaveBeenCalledWith("reveal_in_finder", { path: "/r/app" });
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in editor" }));
    expect(invoke).toHaveBeenCalledWith("open_repo_in_editor", { repoPath: "/r/app" });
  });
});

const commit = {
  id: "0123456789abcdef",
  shortId: "0123456",
  message: "feat: x\n\nbody",
  summary: "feat: x",
  parentIds: ["p"],
} as unknown as CommitInfo;

describe("CommitContextMenu without git actions (other repositories, compare range)", () => {
  it("only copies and opens GitHub", () => {
    render(
      <CommitContextMenu
        commit={commit}
        gitHubUrl="https://github.com/acme/app"
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      i18n.t("history.contextMenu.copyHash"),
      "Copy short SHA",
      i18n.t("history.contextMenu.copyMessage"),
      "View on GitHub",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "View on GitHub" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/app/commit/0123456789abcdef");
  });
});
