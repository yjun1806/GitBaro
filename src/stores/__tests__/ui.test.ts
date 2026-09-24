// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_WIDTH, sanitizePersistedUI, useUIStore } from "@/stores/ui";

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
// the activeTab values, and activeTab is never written to storage, so no
// version bump / migration is needed. These guard both assumptions.
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

  it("starts with the design's sidebar width and keeps the storage unversioned", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(276);
    expect(useUIStore.persist.getOptions().version ?? 0).toBe(0);
  });
});
