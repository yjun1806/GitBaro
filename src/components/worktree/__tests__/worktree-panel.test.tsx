// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useToastStore } from "@/stores/toast";
import type { WorktreeInfo } from "@/types";
import { WorktreePanel } from "../WorktreePanel";

const WT = "/work/app-feat";
const worktrees: WorktreeInfo[] = [
  { path: "/work/app", head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
  { path: WT, head: "b", branch: "feat/x", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe("WorktreePanel", () => {
  it("reports a failed copy of a worktree path", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) } });
    render(
      <WorktreePanel
        anchorRef={createRef<HTMLElement>()}
        repoName="app"
        worktrees={worktrees}
        currentPath="/work/app"
        onOpenWorktree={vi.fn()}
        onOpenTerminal={vi.fn()}
        onOpenEditor={vi.fn()}
        onRemoveWorktree={vi.fn()}
        onCreateWorktree={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText("feat/x"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy path" }));
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.type)).toEqual(["error"]));
  });
});
