// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { WorkflowRun } from "@/types";

const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
const { ActionsRunContextMenu } = await import("../ActionsRunContextMenu");

const writeText = vi.fn(async (_text: string) => {});
const run: WorkflowRun = {
  id: 1,
  name: "CI",
  status: "completed",
  conclusion: "success",
  headBranch: "feat/x",
  headSha: "deadbeef",
  htmlUrl: "https://github.com/acme/app/actions/runs/1",
  createdAt: "",
  updatedAt: "",
  runNumber: 7,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

describe("ActionsRunContextMenu", () => {
  it("opens the run and copies its URL, commit and branch", () => {
    render(<ActionsRunContextMenu run={run} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("actions.contextMenu.openInBrowser") }));
    expect(openUrl).toHaveBeenCalledWith(run.htmlUrl);
    cleanup();
    render(<ActionsRunContextMenu run={run} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("history.contextMenu.copyHash") }));
    expect(writeText).toHaveBeenCalledWith("deadbeef");
  });
});
