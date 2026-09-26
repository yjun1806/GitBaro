// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  UI_STORE_VERSION,
  migrateUI,
  sanitizePersistedUI,
  useUIStore,
} from "@/stores/ui";
import {
  DEFAULT_FILE_LIST_WIDTH,
  DEFAULT_GRAPH_RATIO,
  MAX_FILE_LIST_WIDTH,
  MAX_GRAPH_RATIO,
  MIN_FILE_LIST_WIDTH,
  MIN_GRAPH_RATIO,
} from "@/lib/split-size";

describe("sanitizePersistedUI — split sizes", () => {
  it("keeps saved split sizes", () => {
    expect(sanitizePersistedUI({ graphPanelRatio: 0.3, fileListWidth: 360 })).toEqual({
      graphPanelRatio: 0.3,
      fileListWidth: 360,
    });
  });

  it("clamps out-of-range sizes instead of dropping them", () => {
    expect(sanitizePersistedUI({ graphPanelRatio: 5, fileListWidth: 10 })).toEqual({
      graphPanelRatio: MAX_GRAPH_RATIO,
      fileListWidth: MIN_FILE_LIST_WIDTH,
    });
  });

  it("ignores malformed sizes, so the defaults apply", () => {
    expect(sanitizePersistedUI({ graphPanelRatio: "0.3", fileListWidth: null })).toEqual({});
    expect(sanitizePersistedUI({ graphPanelRatio: Number.NaN })).toEqual({});
  });

  it("keeps an existing v0 user's values when the new fields are missing", () => {
    // 이 필드가 생기기 전에 저장된 값: 사이드바 폭은 그대로 살고, 새 필드는 기본값을 쓴다.
    const v0 = { sidebarWidth: 380, diffLineMode: "split" };
    expect(sanitizePersistedUI(migrateUI(v0, 0))).toEqual(v0);
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge(v0, useUIStore.getInitialState());
    expect(merged.sidebarHidden).toBe(false);
    expect(merged.sidebarWidth).toBe(380);
    expect(merged.graphPanelRatio).toBe(DEFAULT_GRAPH_RATIO);
    expect(merged.fileListWidth).toBe(DEFAULT_FILE_LIST_WIDTH);
  });

  it("does not persist the maximized diff", () => {
    const partialize = useUIStore.persist.getOptions().partialize!;
    expect(partialize({ ...useUIStore.getState(), isDiffMaximized: true })).not.toHaveProperty("isDiffMaximized");
  });

  it("clamps sizes set through the store", () => {
    useUIStore.getState().setFileListWidth(9999);
    expect(useUIStore.getState().fileListWidth).toBe(MAX_FILE_LIST_WIDTH);
    useUIStore.getState().setGraphPanelRatio(0);
    expect(useUIStore.getState().graphPanelRatio).toBe(MIN_GRAPH_RATIO);
    useUIStore.setState({ fileListWidth: DEFAULT_FILE_LIST_WIDTH, graphPanelRatio: DEFAULT_GRAPH_RATIO });
  });
});

describe("sanitizePersistedUI", () => {
  it("keeps well-formed layout preferences", () => {
    expect(
      sanitizePersistedUI({ sidebarHidden: true, sidebarWidth: 420, diffLineMode: "split" }),
    ).toEqual({ sidebarHidden: true, sidebarWidth: 420, diffLineMode: "split" });
  });

  it("drops malformed or unknown values instead of breaking the layout", () => {
    expect(
      sanitizePersistedUI({ sidebarHidden: "yes", sidebarWidth: "500", diffLineMode: "document" }),
    ).toEqual({});
    expect(sanitizePersistedUI({ sidebarWidth: 12 })).toEqual({});
    expect(sanitizePersistedUI({ sidebarWidth: Number.NaN })).toEqual({});
    expect(sanitizePersistedUI(null)).toEqual({});
  });

  it("keeps a saved commit-info expanded/collapsed choice, and ignores a malformed one", () => {
    expect(sanitizePersistedUI({ commitInfoExpanded: true })).toEqual({ commitInfoExpanded: true });
    expect(sanitizePersistedUI({ commitInfoExpanded: "yes" })).toEqual({});
  });

  it("never restores the theme from local storage (backend settings own it)", () => {
    expect(sanitizePersistedUI({ theme: "dark" })).toEqual({});
  });
});

// W2-T1: the two-column shell regroups the tabs in the graph panel but keeps
// the activeTab values, and activeTab is never written to storage. sidebarWidth
// now sizes the tree sidebar instead of the old tab column, but that does not
// warrant a version bump or a migration (the task's own rule: only bump when a
// persisted value's *values* change, which activeTab's did not).
describe("ui store after the two-column shell", () => {
  it("does not persist activeTab, so old stored values cannot leak in", () => {
    useUIStore.getState().setActiveTab("stash");
    const partialize = useUIStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    expect(Object.keys(partialize!(useUIStore.getState()) as object).sort()).toEqual([
      "commitInfoExpanded",
      "diffLineMode",
      "fileListWidth",
      "graphPanelRatio",
      "maximizedFileListOpen",
      "reviewFileView",
      "reviewFileViewByWorkspace",
      "sidebarHidden",
      "sidebarWidth",
    ]);
    expect(sanitizePersistedUI({ activeTab: "changes" })).toEqual({});
  });

  it("starts pinned open at the design's sidebar width", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(276);
    expect(useUIStore.getInitialState().sidebarHidden).toBe(false);
    expect(useUIStore.getInitialState().sidebarWidth).toBe(276);
  });

  it("stays at version 0 with an identity migration (no activeTab value changed)", () => {
    expect(UI_STORE_VERSION).toBe(0);
    expect(useUIStore.persist.getOptions().version).toBe(0);
    expect(useUIStore.persist.getOptions().migrate).toBeDefined();
  });
});

describe("migrateUI", () => {
  it("passes every field through unchanged regardless of version", () => {
    const v0 = { sidebarHidden: true, sidebarWidth: 500, diffLineMode: "split" };
    expect(migrateUI(v0, 0)).toEqual(v0);
    expect(migrateUI(v0, 1)).toEqual(v0);
  });

  it("tolerates empty or broken storage", () => {
    expect(migrateUI(null, 0)).toBeNull();
    expect(sanitizePersistedUI(migrateUI("junk", 0))).toEqual({});
  });

  it("keeps a hidden sidebar and its width across rehydration", async () => {
    // setState writes storage too, so reset first, then plant the entry.
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, sidebarHidden: false });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({ state: { sidebarHidden: true, sidebarWidth: 500 }, version: 0 }),
    );
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().sidebarHidden).toBe(true);
    expect(useUIStore.getState().sidebarWidth).toBe(500);
    localStorage.removeItem("gitbaro-ui");
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, sidebarHidden: false });
  });
});

// 옛 빌드의 railMode(펼침·접힘·hover)는 없앴다. 무엇을 골랐든 업그레이드하면 트리가 보이는
// 펼침(숨기지 않음)으로 열리고, 다른 저장값은 그대로 산다.
describe("migration from the removed rail modes", () => {
  it.each(["expanded", "collapsed", "hover"])("maps an old %s rail to the pinned, visible sidebar", async (railMode) => {
    const merge = useUIStore.persist.getOptions().merge!;
    expect(merge({ railMode, sidebarWidth: 340 }, useUIStore.getInitialState()).sidebarHidden).toBe(false);

    // 앱을 켤 때와 같이 기본 상태에서 옛 저장값을 읽는다(setState가 저장소에도 쓰므로 먼저 둔다).
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, sidebarHidden: false, diffLineMode: "unified" });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({ state: { railMode, sidebarWidth: 340, diffLineMode: "split", fileListWidth: 360 }, version: 0 }),
    );
    await useUIStore.persist.rehydrate();
    const state = useUIStore.getState();
    expect(state.sidebarHidden).toBe(false);
    expect(state).toMatchObject({ sidebarWidth: 340, diffLineMode: "split", fileListWidth: 360 });
    expect(state).not.toHaveProperty("railMode");
    expect(useUIStore.persist.getOptions().partialize!(state)).not.toHaveProperty("railMode");
    localStorage.removeItem("gitbaro-ui");
    useUIStore.setState({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      diffLineMode: "unified",
      fileListWidth: DEFAULT_FILE_LIST_WIDTH,
    });
  });

  it("does not read the old field when sanitizing", () => {
    expect(sanitizePersistedUI({ railMode: "collapsed", sidebarWidth: 300 })).toEqual({ sidebarWidth: 300 });
  });
});

describe("sidebar toggle", () => {
  it("hides and shows the sidebar and persists the choice", () => {
    expect(useUIStore.getState().sidebarHidden).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarHidden).toBe(true);
    expect(useUIStore.persist.getOptions().partialize!(useUIStore.getState())).toMatchObject({ sidebarHidden: true });
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarHidden).toBe(false);
    useUIStore.getState().setSidebarHidden(true);
    expect(useUIStore.getState().sidebarHidden).toBe(true);
    useUIStore.getState().setSidebarHidden(false);
  });
});

describe("sanitizePersistedUI — removed review basis setting", () => {
  it("ignores a leftover reviewBasis from an older build and keeps the other saved fields", () => {
    const saved = { sidebarHidden: true, sidebarWidth: 300, diffLineMode: "split" };
    expect(sanitizePersistedUI({ ...saved, reviewBasis: "unseen" })).toEqual(saved);
  });
});

describe("maximized diff file list", () => {
  it("is open by default and remembered across restarts", () => {
    expect(useUIStore.getInitialState().maximizedFileListOpen).toBe(true);
    useUIStore.getState().setMaximizedFileListOpen(false);
    const partialize = useUIStore.persist.getOptions().partialize!;
    expect(partialize(useUIStore.getState())).toMatchObject({ maximizedFileListOpen: false });
    useUIStore.getState().setMaximizedFileListOpen(true);
  });

  it("keeps a saved choice and drops a malformed one", () => {
    expect(sanitizePersistedUI({ maximizedFileListOpen: false })).toEqual({ maximizedFileListOpen: false });
    expect(sanitizePersistedUI({ maximizedFileListOpen: "no" })).toEqual({});
  });

  it("restores the choice without touching other saved fields", async () => {
    useUIStore.setState({ sidebarHidden: false, maximizedFileListOpen: true });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({
        state: { sidebarHidden: true, sidebarWidth: 330, reviewBasis: "unseen", maximizedFileListOpen: false },
        version: 0,
      }),
    );
    await useUIStore.persist.rehydrate();
    const state = useUIStore.getState();
    expect(state.maximizedFileListOpen).toBe(false);
    expect(state).toMatchObject({ sidebarHidden: true, sidebarWidth: 330 });
    // 옛 빌드가 남긴 reviewBasis는 상태에 들어오지 않고, 다음 저장에서 빠진다.
    expect(state).not.toHaveProperty("reviewBasis");
    expect(useUIStore.persist.getOptions().partialize!(state)).not.toHaveProperty("reviewBasis");
    localStorage.removeItem("gitbaro-ui");
    useUIStore.setState({ maximizedFileListOpen: true, sidebarHidden: false, sidebarWidth: DEFAULT_SIDEBAR_WIDTH });
  });

  it("falls back to open for users who saved before the field existed", () => {
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge({ sidebarHidden: true, sidebarWidth: 300 }, useUIStore.getInitialState());
    expect(merged.maximizedFileListOpen).toBe(true);
    expect(merged.sidebarHidden).toBe(true);
  });
});

describe("review file view per workspace", () => {
  it("starts every workspace at commit order (an empty map)", () => {
    expect(useUIStore.getInitialState().reviewFileViewByWorkspace).toEqual({});
  });

  it("remembers a workspace's choice without touching another workspace's", () => {
    useUIStore.getState().setReviewFileView("w1", "files");
    useUIStore.getState().setReviewFileView("w2", "commits");
    expect(useUIStore.getState().reviewFileViewByWorkspace).toEqual({ w1: "files", w2: "commits" });
    const partialize = useUIStore.persist.getOptions().partialize!;
    expect(partialize(useUIStore.getState())).toMatchObject({ reviewFileViewByWorkspace: { w1: "files", w2: "commits" } });
    useUIStore.setState({ reviewFileViewByWorkspace: {} });
  });

  it("keeps a saved map and drops an unknown view value", () => {
    expect(sanitizePersistedUI({ reviewFileViewByWorkspace: { w1: "files" } })).toEqual({
      reviewFileViewByWorkspace: { w1: "files" },
    });
    expect(sanitizePersistedUI({ reviewFileViewByWorkspace: { w1: "graph" } })).toEqual({
      reviewFileViewByWorkspace: {},
    });
    expect(sanitizePersistedUI({ reviewFileViewByWorkspace: "junk" })).toEqual({});
  });

  it("falls back to an empty map for users who saved before the field existed", () => {
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge({ sidebarHidden: true }, useUIStore.getInitialState());
    expect(merged.reviewFileViewByWorkspace).toEqual({});
  });
});

// 범위 하나로 보기(워크스페이스·저장소·브랜치)는 [커밋 순서 | 파일별]을 워크스페이스별 맵이
// 아니라 값 하나로 함께 쓴다. 옛 `reviewFileViewByWorkspace` 저장값은 읽지 못한 빌드로
// 되돌아갈 사용자를 위해 그대로 두되(위 describe), 더는 읽지 않는다.
describe("review file view (범위 전역 값)", () => {
  it("starts at commit order", () => {
    expect(useUIStore.getInitialState().reviewFileView).toBe("commits");
  });

  it("remembers the choice and persists it", () => {
    useUIStore.getState().setScopeFileView("files");
    expect(useUIStore.getState().reviewFileView).toBe("files");
    const partialize = useUIStore.persist.getOptions().partialize!;
    expect(partialize(useUIStore.getState())).toMatchObject({ reviewFileView: "files" });
    useUIStore.setState({ reviewFileView: "commits" });
  });

  it("keeps a saved value and drops an unknown one", () => {
    expect(sanitizePersistedUI({ reviewFileView: "files" })).toEqual({ reviewFileView: "files" });
    expect(sanitizePersistedUI({ reviewFileView: "graph" })).toEqual({});
  });

  it("falls back to commit order for users who saved before the field existed", () => {
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge({ sidebarHidden: true }, useUIStore.getInitialState());
    expect(merged.reviewFileView).toBe("commits");
  });

  it("does not let an old reviewFileViewByWorkspace value leak into the new field", () => {
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge(
      { reviewFileViewByWorkspace: { w1: "files" } },
      useUIStore.getInitialState(),
    );
    expect(merged.reviewFileView).toBe("commits");
    expect(merged.reviewFileViewByWorkspace).toEqual({ w1: "files" });
  });
});
