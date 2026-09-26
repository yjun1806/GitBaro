// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useUIStore } from "@/stores/ui";
import { useFollowStore } from "@/stores/follow";
import { useHistoryViewStore } from "@/stores/history-view";
import type { StatusEntry } from "@/types";

const REPO = "/work/app";
const status: StatusEntry[] = [
  { path: "a.ts", status: "modified", staged: true },
  { path: "a.ts", status: "modified", staged: false },
  { path: "b.ts", status: "untracked", staged: false },
];
vi.mock("@/api/queries", () => ({ useStatus: () => ({ data: status }) }));

const { RepoWorkSwitcher } = await import("../WorkSwitcher");

function renderSwitcher(mode: "working" | "commit") {
  render(<RepoWorkSwitcher mode={mode} />);
  return screen.getByTestId("work-switcher");
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useRepositoryStore.setState({ activeRepoPath: REPO });
  useSelectionStore.getState().clearAll();
  useHistoryViewStore.getState().reset();
  useFollowStore.getState().stop();
  useUIStore.setState({ activeTab: "history", workingFocusAt: null });
});
afterEach(cleanup);

describe("RepoWorkSwitcher", () => {
  it("shows the working changes count and no commit when nothing is picked", () => {
    const switcher = renderSwitcher("working");
    const working = within(switcher).getByRole("radio", { name: "Working changes 2" });
    expect(working.getAttribute("aria-checked")).toBe("true");
    const commit = within(switcher).getByRole("radio", { name: "No commit selected" });
    expect(commit).toHaveProperty("disabled", true);
  });

  it("names the picked commit and goes back to working changes, clearing the pick and focusing the list", () => {
    useSelectionStore.getState().selectCommit("abcdef1234567");
    const switcher = renderSwitcher("commit");
    const commit = within(switcher).getByRole("radio", { name: "Commit abcdef1" });
    expect(commit.getAttribute("aria-checked")).toBe("true");

    useFollowStore.getState().start("/work/app-feat");
    fireEvent.click(within(switcher).getByRole("radio", { name: "Working changes 2" }));
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
    expect(useFollowStore.getState().target).toBeNull();
    expect(useUIStore.getState().workingFocusAt).not.toBeNull();
  });

  it("goes to the commit detail from the commit segment", () => {
    useUIStore.setState({ activeTab: "changes" });
    useSelectionStore.getState().selectCommit("abcdef1234567");
    const switcher = renderSwitcher("working");
    act(() => within(switcher).getByRole("radio", { name: "Commit abcdef1" }).click());
    expect(useUIStore.getState().activeTab).toBe("history");
  });

  it("turns off working changes while another branch is viewed", async () => {
    await i18n.changeLanguage("ko");
    useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false });
    const switcher = renderSwitcher("commit");
    const working = within(switcher).getByRole("radio", { name: "작업 중인 변경 · 체크아웃한 브랜치에서만" });
    expect(working).toHaveProperty("disabled", true);
    expect(within(switcher).getByRole("radio", { name: "커밋 선택 안 됨" })).toBeTruthy();
  });
});
