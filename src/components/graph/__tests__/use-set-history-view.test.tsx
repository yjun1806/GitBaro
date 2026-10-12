// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSetHistoryView } from "../useHistoryView";
import { useRepositoryStore } from "@/stores/repository";
import { useScopeStore } from "@/components/scope/scope-store";

const REPO = "/repos/api";

describe("useSetHistoryView", () => {
  beforeEach(() => {
    useRepositoryStore.setState({ activeRepoPath: REPO });
    useScopeStore.setState({ aggregateRepoPath: REPO });
  });

  it("leaves the repository step when a local branch is picked", () => {
    const { result } = renderHook(() => useSetHistoryView());
    act(() => result.current({ kind: "ref", name: "feat/login", isRemote: false }));
    expect(useScopeStore.getState().aggregateRepoPath).toBeNull();
  });

  it("stays in the repository step for a remote branch or all branches", () => {
    const { result } = renderHook(() => useSetHistoryView());
    act(() => result.current({ kind: "ref", name: "origin/feat/login", isRemote: true }));
    expect(useScopeStore.getState().aggregateRepoPath).toBe(REPO);
    act(() => result.current({ kind: "all" }));
    expect(useScopeStore.getState().aggregateRepoPath).toBe(REPO);
  });
});
