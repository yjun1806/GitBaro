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
    // 이 필드가 생기기 전에 저장된 값: 사이드바 모드·폭은 그대로 살고, 새 필드는 기본값을 쓴다.
    const v0 = { railMode: "hover", sidebarWidth: 380, diffLineMode: "split" };
    expect(sanitizePersistedUI(migrateUI(v0, 0))).toEqual(v0);
    const merge = useUIStore.persist.getOptions().merge!;
    const merged = merge(v0, useUIStore.getInitialState());
    expect(merged.railMode).toBe("hover");
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
      sanitizePersistedUI({ railMode: "collapsed", sidebarWidth: 420, diffLineMode: "split" }),
    ).toEqual({ railMode: "collapsed", sidebarWidth: 420, diffLineMode: "split" });
  });

  it("drops malformed or unknown values instead of breaking the layout", () => {
    expect(
      sanitizePersistedUI({ railMode: "wide", sidebarWidth: "500", diffLineMode: "document" }),
    ).toEqual({});
    expect(sanitizePersistedUI({ sidebarWidth: 12 })).toEqual({});
    expect(sanitizePersistedUI({ sidebarWidth: Number.NaN })).toEqual({});
    expect(sanitizePersistedUI(null)).toEqual({});
  });

  it("never restores the theme from local storage (backend settings own it)", () => {
    expect(sanitizePersistedUI({ theme: "dark" })).toEqual({});
  });
});

// W2-T1: the two-column shell regroups the tabs in the graph panel but keeps
// the activeTab values, and activeTab is never written to storage. sidebarWidth
// now sizes the tree sidebar instead of the old tab column, but that does not
// warrant a version bump or a migration (the task's own rule: only bump when a
// persisted value's *values* change, which activeTab's did not). A v0 user's
// railMode and sidebarWidth are kept as-is (W2-T2: keep the rail's
// collapsed/hover modes).
describe("ui store after the two-column shell", () => {
  it("does not persist activeTab, so old stored values cannot leak in", () => {
    useUIStore.getState().setActiveTab("stash");
    const partialize = useUIStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    expect(Object.keys(partialize!(useUIStore.getState()) as object).sort()).toEqual([
      "diffLineMode",
      "fileListWidth",
      "graphPanelRatio",
      "railMode",
      "sidebarWidth",
    ]);
    expect(sanitizePersistedUI({ activeTab: "changes" })).toEqual({});
  });

  it("starts pinned open at the design's sidebar width", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(276);
    expect(useUIStore.getInitialState().railMode).toBe("expanded");
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
    const v0 = { railMode: "hover", sidebarWidth: 500, diffLineMode: "split" };
    expect(migrateUI(v0, 0)).toEqual(v0);
    expect(migrateUI(v0, 1)).toEqual(v0);
  });

  it("tolerates empty or broken storage", () => {
    expect(migrateUI(null, 0)).toBeNull();
    expect(sanitizePersistedUI(migrateUI("junk", 0))).toEqual({});
  });

  it("keeps a v0 user's deliberately chosen rail mode and width across rehydration (W2-T2)", async () => {
    // setState writes storage too, so reset first, then plant the old entry.
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, railMode: "expanded" });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({ state: { railMode: "collapsed", sidebarWidth: 500 }, version: 0 }),
    );
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().railMode).toBe("collapsed");
    expect(useUIStore.getState().sidebarWidth).toBe(500);
    localStorage.removeItem("gitbaro-ui");
  });

  it("keeps a deliberately chosen hover rail mode across rehydration", async () => {
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, railMode: "expanded" });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({ state: { railMode: "hover", sidebarWidth: 320, diffLineMode: "unified" }, version: 0 }),
    );
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().railMode).toBe("hover");
    expect(useUIStore.getState().sidebarWidth).toBe(320);
    localStorage.removeItem("gitbaro-ui");
  });
});
