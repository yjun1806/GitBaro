// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useUIStore } from "@/stores/ui";

describe("repo switch resets", () => {
  it("clears the History compare/preview branch when the active repo changes", () => {
    useRepositoryStore.setState({ activeRepoPath: "/repos/alpha" });
    useUIStore.setState({ compareBranch: "feature", previewBranch: "feature" });
    useSelectionStore.getState().selectCommit("abc");

    useRepositoryStore.setState({ activeRepoPath: "/repos/beta" });

    expect(useUIStore.getState().compareBranch).toBeNull();
    expect(useUIStore.getState().previewBranch).toBeNull();
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
  });
});
