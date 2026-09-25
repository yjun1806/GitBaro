// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import type { StatusEntry } from "@/types";

const invoke = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const { FileContextMenu } = await import("../FileContextMenu");
const { useWorkingFileMenu } = await import("../useWorkingFileMenu");

const writeText = vi.fn(async (_text: string) => {});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

function labels(): (string | null)[][] {
  // 구분선으로 나뉜 묶음별 항목 이름.
  const menu = screen.getByRole("menu");
  return Array.from(menu.children).map((group) =>
    within(group as HTMLElement)
      .queryAllByRole("menuitem")
      .map((b) => b.textContent),
  );
}

describe("FileContextMenu", () => {
  it("offers only opening and copying on a read-only list", () => {
    render(<FileContextMenu repoPath="/r" filePath="src/a.ts" position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(labels()).toEqual([
      ["Open in editor", "Reveal in Finder"],
      ["Copy relative path", "Copy full path"],
    ]);
  });

  it("puts stage first and discard last, alone, on a working-changes row", () => {
    const working = { staged: false, canDiscard: true, onToggleStage: vi.fn(), onDiscard: vi.fn(), onAddToGitignore: vi.fn() };
    render(
      <FileContextMenu repoPath="/r" filePath="a.ts" working={working} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    const groups = labels();
    expect(groups[0]).toEqual(["Stage file"]);
    expect(groups[groups.length - 1]).toEqual(["Discard changes"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes" }));
    expect(working.onDiscard).toHaveBeenCalled();
  });

  it("copies the full path joined to the repository and opens the file through the editor command", async () => {
    const onClose = vi.fn();
    render(<FileContextMenu repoPath="/r/" filePath="src/a.ts" position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy full path" }));
    expect(writeText).toHaveBeenCalledWith("/r/src/a.ts");
    expect(onClose).toHaveBeenCalled();
    cleanup();
    render(<FileContextMenu repoPath="/r" filePath="src/a.ts" position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in editor" }));
    expect(invoke).toHaveBeenCalledWith("open_in_editor", { repoPath: "/r", filePath: "src/a.ts" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(invoke).toHaveBeenCalledWith("reveal_in_finder", { path: "/r/src/a.ts" });
  });

  it("cannot open a deleted file", () => {
    render(
      <FileContextMenu repoPath="/r" filePath="gone.ts" exists={false} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    expect((screen.getByRole("menuitem", { name: "Open in editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: "Reveal in Finder" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

function Host({ entry }: { entry: StatusEntry }) {
  const menu = useWorkingFileMenu("/r");
  return (
    <>
      <button type="button" onClick={() => menu.openMenu(entry, { x: 1, y: 1 })}>
        open
      </button>
      {menu.element}
    </>
  );
}

function renderHost(entry: StatusEntry) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Host entry={entry} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("open"));
}

describe("useWorkingFileMenu", () => {
  it("asks before discarding and only discards after confirming", async () => {
    renderHost({ path: "a.ts", status: "modified", staged: false });
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes" }));
    expect(invoke).not.toHaveBeenCalledWith("discard_changes", expect.anything());
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    });
    expect(invoke).toHaveBeenCalledWith("discard_changes", { repoPath: "/r", paths: ["a.ts"], staged: false });
  });

  it("keeps the files when the discard is cancelled", () => {
    renderHost({ path: "a.ts", status: "modified", staged: false });
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("discard_changes", expect.anything());
  });

  it("stages an unstaged row", async () => {
    renderHost({ path: "a.ts", status: "modified", staged: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Stage file" }));
    });
    expect(invoke).toHaveBeenCalledWith("stage_files", { repoPath: "/r", paths: ["a.ts"] });
  });

  it("cannot discard a conflicted file from the menu", () => {
    renderHost({ path: "a.ts", status: "conflicted", staged: false });
    expect((screen.getByRole("menuitem", { name: "Discard changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
