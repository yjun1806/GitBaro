import { beforeEach, describe, expect, it } from "vitest";
import { useCommitDraftStore } from "@/stores/commit-draft";

const state = () => useCommitDraftStore.getState();

describe("useCommitDraftStore", () => {
  beforeEach(() => {
    useCommitDraftStore.setState({ drafts: {} });
  });

  it("keeps a separate draft per repository", () => {
    state().setDraft("/repo/a", { summary: "fix a" });
    state().setDraft("/repo/b", { summary: "fix b", description: "body" });
    state().setDraft("/repo/a", { description: "why" });

    expect(state().drafts["/repo/a"]).toEqual({ summary: "fix a", description: "why" });
    expect(state().drafts["/repo/b"]).toEqual({ summary: "fix b", description: "body" });
  });

  it("clears only the committed repository's draft", () => {
    state().setDraft("/repo/a", { summary: "a" });
    state().setDraft("/repo/b", { summary: "b" });
    state().clearDraft("/repo/a");

    expect(state().drafts["/repo/a"]).toBeUndefined();
    expect(state().drafts["/repo/b"]?.summary).toBe("b");
  });
});
