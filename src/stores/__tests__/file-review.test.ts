// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DETACHED,
  MAX_MARKS_PER_REPO,
  fileContentId,
  isViewed,
  sanitizePersistedFileReview,
  useFileReviewStore,
  type FileReviewScope,
} from "@/stores/file-review";

const REPO = "/work/app";
const FEAT: FileReviewScope = { branch: "feat/x", base: "main" };

function viewed(path: string, contentId: string, scope = FEAT, repo = REPO): boolean {
  return isViewed(useFileReviewStore.getState().marksByRepo[repo], scope, { path, contentId });
}

beforeEach(() => {
  localStorage.clear();
  useFileReviewStore.setState({ marksByRepo: {}, collapseViewed: false });
});

describe("useFileReviewStore", () => {
  it("remembers a file as viewed for the content it had", () => {
    useFileReviewStore.getState().markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "blob1" }]);

    expect(viewed("a.ts", "blob1")).toBe(true);
    expect(viewed("b.ts", "blob1")).toBe(false);
  });

  it("stops counting the mark once the agent edits the file again", () => {
    useFileReviewStore.getState().markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "blob1" }]);

    expect(viewed("a.ts", "blob2")).toBe(false);
  });

  it("keeps marks separate per branch, base and repository", () => {
    useFileReviewStore.getState().markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "blob1" }]);

    expect(viewed("a.ts", "blob1", { branch: "feat/x", base: "dev" })).toBe(false);
    expect(viewed("a.ts", "blob1", { branch: "feat/y", base: "main" })).toBe(false);
    expect(viewed("a.ts", "blob1", FEAT, "/work/other")).toBe(false);
  });

  it("treats a trailing slash on the repository path as the same repository", () => {
    useFileReviewStore.getState().markViewed(`${REPO}/`, FEAT, [{ path: "a.ts", contentId: "blob1" }]);

    expect(viewed("a.ts", "blob1")).toBe(true);
  });

  it("unmarks only the given files", () => {
    const { markViewed, unmarkViewed } = useFileReviewStore.getState();
    markViewed(REPO, FEAT, [
      { path: "a.ts", contentId: "1" },
      { path: "b.ts", contentId: "2" },
    ]);
    unmarkViewed(REPO, FEAT, ["a.ts"]);

    expect(viewed("a.ts", "1")).toBe(false);
    expect(viewed("b.ts", "2")).toBe(true);
  });

  it("drops the repository entry when its last mark goes", () => {
    const { markViewed, unmarkViewed } = useFileReviewStore.getState();
    markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "1" }]);
    unmarkViewed(REPO, FEAT, ["a.ts"]);

    expect(useFileReviewStore.getState().marksByRepo).toEqual({});
  });

  describe("reconcile", () => {
    it("clears marks of files whose content changed or that left the list, in this scope only", () => {
      const { markViewed, reconcile } = useFileReviewStore.getState();
      markViewed(REPO, FEAT, [
        { path: "same.ts", contentId: "s" },
        { path: "edited.ts", contentId: "old" },
        { path: "reverted.ts", contentId: "r" },
      ]);
      const other = { branch: "feat/y", base: "main" };
      markViewed(REPO, other, [{ path: "edited.ts", contentId: "old" }]);

      reconcile(REPO, FEAT, [
        { path: "same.ts", contentId: "s" },
        { path: "edited.ts", contentId: "new" },
      ]);

      const marks = useFileReviewStore.getState().marksByRepo[REPO];
      expect(Object.values(marks).map((m) => `${m.branch}:${m.path}`).sort()).toEqual([
        "feat/x:same.ts",
        "feat/y:edited.ts",
      ]);
    });

    it("leaves the state untouched when nothing changed", () => {
      useFileReviewStore.getState().markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "1" }]);
      const before = useFileReviewStore.getState().marksByRepo;

      useFileReviewStore.getState().reconcile(REPO, FEAT, [{ path: "a.ts", contentId: "1" }]);

      expect(useFileReviewStore.getState().marksByRepo).toBe(before);
    });
  });

  it("drops marks whose branch or base no longer exists, keeping detached ones", () => {
    const { markViewed, pruneMissingRefs } = useFileReviewStore.getState();
    markViewed(REPO, FEAT, [{ path: "a.ts", contentId: "1" }]);
    markViewed(REPO, { branch: "gone", base: "main" }, [{ path: "b.ts", contentId: "2" }]);
    markViewed(REPO, { branch: "feat/x", base: "origin/gone" }, [{ path: "c.ts", contentId: "3" }]);
    markViewed(REPO, { branch: DETACHED, base: "origin/main" }, [{ path: "d.ts", contentId: "4" }]);

    pruneMissingRefs(REPO, new Set(["feat/x", "main", "origin/main"]));

    const paths = Object.values(useFileReviewStore.getState().marksByRepo[REPO]).map((m) => m.path);
    expect(paths.sort()).toEqual(["a.ts", "d.ts"]);
  });

  it("caps the marks kept per repository, dropping the oldest", () => {
    const files = Array.from({ length: MAX_MARKS_PER_REPO + 5 }, (_, i) => ({ path: `f${i}.ts`, contentId: "x" }));
    useFileReviewStore.getState().markViewed(REPO, FEAT, files);

    expect(Object.keys(useFileReviewStore.getState().marksByRepo[REPO])).toHaveLength(MAX_MARKS_PER_REPO);
  });
});

describe("fileContentId", () => {
  it("uses the blob id, and the status when there is no content", () => {
    expect(fileContentId({ status: "modified", blobId: "abc" })).toBe("abc");
    expect(fileContentId({ status: "deleted", blobId: null })).toBe("no-content:deleted");
    expect(fileContentId({ status: "deleted" })).toBe("no-content:deleted");
  });
});

describe("sanitizePersistedFileReview", () => {
  const mark = { branch: "feat/x", base: "main", path: "a.ts", contentId: "1", at: 5 };

  it("keeps well-formed marks and rebuilds their keys", () => {
    const out = sanitizePersistedFileReview({
      marksByRepo: { [`${REPO}/`]: { "stale-key": mark } },
      collapseViewed: true,
    });

    expect(out.collapseViewed).toBe(true);
    expect(isViewed(out.marksByRepo[REPO], FEAT, { path: "a.ts", contentId: "1" })).toBe(true);
  });

  it("drops malformed marks, repositories and flags", () => {
    const out = sanitizePersistedFileReview({
      marksByRepo: {
        [REPO]: {
          a: { ...mark, contentId: 3 },
          b: { ...mark, path: "" },
          c: { ...mark, at: Number.NaN },
          d: null,
        },
        "/work/bad": "nope",
      },
      collapseViewed: "yes",
    });

    expect(out).toEqual({ marksByRepo: {}, collapseViewed: false });
  });

  it("survives a missing or broken stored value", () => {
    expect(sanitizePersistedFileReview(undefined)).toEqual({ marksByRepo: {}, collapseViewed: false });
    expect(sanitizePersistedFileReview("x")).toEqual({ marksByRepo: {}, collapseViewed: false });
    expect(sanitizePersistedFileReview({ marksByRepo: [] })).toEqual({ marksByRepo: {}, collapseViewed: false });
  });

  it("restores saved marks on rehydrate without touching other stores' keys", async () => {
    localStorage.setItem("gitbaro-ui", "untouched");
    localStorage.setItem(
      "gitbaro-file-review",
      JSON.stringify({
        state: { marksByRepo: { [REPO]: { x: mark, y: { ...mark, path: 7 } } }, collapseViewed: true },
        version: 0,
      }),
    );

    await useFileReviewStore.persist.rehydrate();

    const state = useFileReviewStore.getState();
    expect(Object.values(state.marksByRepo[REPO])).toEqual([mark]);
    expect(state.collapseViewed).toBe(true);
    expect(localStorage.getItem("gitbaro-ui")).toBe("untouched");
  });

  it("applies the per-repository cap to stored marks", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_MARKS_PER_REPO + 3 }, (_, i) => [String(i), { ...mark, path: `f${i}`, at: i }]),
    );
    const out = sanitizePersistedFileReview({ marksByRepo: { [REPO]: many } });
    const kept = Object.values(out.marksByRepo[REPO]);

    expect(kept).toHaveLength(MAX_MARKS_PER_REPO);
    expect(kept.some((m) => m.path === "f0")).toBe(false);
  });
});
