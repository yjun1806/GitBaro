// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";

describe("repo switch resets", () => {
  it("clears the selection when the active repo changes", () => {
    useRepositoryStore.setState({ activeRepoPath: "/repos/alpha" });
    useSelectionStore.getState().selectCommit("abc");

    useRepositoryStore.setState({ activeRepoPath: "/repos/beta" });

    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
  });
});
