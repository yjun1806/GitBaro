// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@/i18n/config";
import { WorkSwitcher } from "../WorkSwitcher";
import { CommitComposer } from "../CommitComposer";
import { FileEntry } from "../FileEntry";

afterEach(cleanup);

describe("narrow working changes panel", () => {
  it("lets both switcher tabs shrink and truncate, with a tooltip for the commit tab", () => {
    render(
      <WorkSwitcher mode="working" workingCount={1} commitShortId="abcdef1" onWorking={vi.fn()} onCommit={vi.fn()} />,
    );
    const tabs = within(screen.getByTestId("work-switcher")).getAllByRole("radio");
    for (const tab of tabs) {
      expect(tab.className).toContain("min-w-0");
      expect(tab.querySelector("span")?.className).toContain("truncate");
    }
    expect(tabs[1].getAttribute("title")).toContain("abcdef1");
  });

  it("wraps the commit button onto its own row instead of overflowing", () => {
    render(
      <CommitComposer
        summary=""
        description=""
        onSummaryChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        branchLabel="main"
        targetTitle="target"
        canCommit
        isCommitting={false}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("commit-actions").className).toContain("flex-wrap");
    const button = screen.getByTestId("commit-target");
    expect(button.className).toContain("max-w-full");
    expect(button.querySelector("span")?.className).toContain("truncate");
  });

  it("truncates the file name, keeps the line delta, and hides the time when the row is narrow", () => {
    render(
      <FileEntry
        entry={{ path: "a/evaluations.jsonl", status: "modified", staged: false, insertions: 4, deletions: 0, modifiedAt: 1 }}
        isSelected={false}
        onClick={vi.fn()}
        onToggleStage={vi.fn()}
      />,
    );
    const name = screen.getByText("evaluations.jsonl");
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("truncate");
    const time = name.parentElement?.querySelector("span.hidden");
    expect(time?.className).toContain("@min-[260px]/file:inline");
    expect(name.parentElement?.className).toContain("@container/file");
  });
});
