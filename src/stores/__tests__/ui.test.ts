// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  UI_STORE_VERSION,
  migrateUI,
  sanitizePersistedUI,
  useUIStore,
} from "@/stores/ui";

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
// the activeTab values, and activeTab is never written to storage. What did
// change is the meaning of sidebarWidth (old tab column -> tree sidebar), which
// the v0 -> v1 migration handles.
describe("ui store after the two-column shell", () => {
  it("does not persist activeTab, so old stored values cannot leak in", () => {
    useUIStore.getState().setActiveTab("stash");
    const partialize = useUIStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    expect(Object.keys(partialize!(useUIStore.getState()) as object).sort()).toEqual([
      "diffLineMode",
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

  it("is stored as version 1 with a migration", () => {
    expect(UI_STORE_VERSION).toBe(1);
    expect(useUIStore.persist.getOptions().version).toBe(1);
    expect(useUIStore.persist.getOptions().migrate).toBeDefined();
  });
});

describe("migrateUI", () => {
  it("drops the v0 tab-column width so the sidebar starts at the design width", () => {
    // What the old build wrote after any tab click (whole state, default 500).
    const v0 = { railMode: "hover", sidebarWidth: 500, diffLineMode: "split" };
    const migrated = migrateUI(v0, 0);
    expect(migrated).toEqual({ railMode: "hover", diffLineMode: "split" });
    // The input is not changed.
    expect(v0.sidebarWidth).toBe(500);
    // After merge the default applies.
    const merged = { ...useUIStore.getInitialState(), ...sanitizePersistedUI(migrated) };
    expect(merged.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(merged.railMode).toBe("hover");
  });

  it("keeps a v1 width and tolerates empty or broken storage", () => {
    expect(migrateUI({ sidebarWidth: 320 }, 1)).toEqual({ sidebarWidth: 320 });
    expect(migrateUI(null, 0)).toBeNull();
    expect(sanitizePersistedUI(migrateUI("junk", 0))).toEqual({});
  });

  it("runs through persist rehydration for a v0 entry", async () => {
    // setState writes storage too, so reset first, then plant the old entry.
    useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, railMode: "expanded" });
    localStorage.setItem(
      "gitbaro-ui",
      JSON.stringify({ state: { railMode: "collapsed", sidebarWidth: 500 }, version: 0 }),
    );
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().railMode).toBe("collapsed");
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    localStorage.removeItem("gitbaro-ui");
  });
});
