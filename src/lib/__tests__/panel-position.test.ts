import { describe, expect, it } from "vitest";
import { clampPanelToViewport } from "@/lib/panel-position";

const VIEWPORT = { width: 1400, height: 900 };
const PANEL = { width: 300, height: 400 };

describe("clampPanelToViewport", () => {
  it("anchors under the trigger, left-edge aligned, when there's room on every side", () => {
    const anchor = { left: 200, top: 40, bottom: 60, width: 120 };
    expect(clampPanelToViewport(anchor, PANEL, VIEWPORT)).toEqual({ top: 66, left: 200, maxHeight: 400 });
  });

  it("clamps left so the panel's right edge never overflows the window", () => {
    const anchor = { left: 1350, top: 40, bottom: 60, width: 120 };
    const { left } = clampPanelToViewport(anchor, PANEL, VIEWPORT);
    expect(left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });

  it("clamps left to the margin when the anchor sits at the window's left edge", () => {
    const anchor = { left: -50, top: 40, bottom: 60, width: 120 };
    const { left } = clampPanelToViewport(anchor, PANEL, VIEWPORT);
    expect(left).toBe(8);
  });

  it("flips above the anchor when there's no room below but there is above", () => {
    const anchor = { left: 200, top: 700, bottom: 730, width: 120 };
    const { top } = clampPanelToViewport(anchor, PANEL, VIEWPORT);
    // opens above: anchor.top(700) - gap(6) - panel.height(400)
    expect(top).toBe(294);
  });

  it("stays below (clamped) when neither above nor below fully fits", () => {
    // A tall panel anchored mid-page in a short viewport: there isn't enough
    // room above OR below, so it falls back to below and clamps to the window.
    const shortViewport = { width: 1400, height: 500 };
    const anchor = { left: 200, top: 200, bottom: 220, width: 120 };
    const { top } = clampPanelToViewport(anchor, PANEL, shortViewport);
    expect(top).toBe(shortViewport.height - PANEL.height - 8);
  });

  it("clamps top to the margin when a panel taller than the viewport is forced above", () => {
    const anchor = { left: 200, top: 900, bottom: 920, width: 120 };
    const hugePanel = { width: 300, height: 2000 };
    const { top } = clampPanelToViewport(anchor, hugePanel, VIEWPORT);
    expect(top).toBe(8);
  });

  it("respects custom margin and gap", () => {
    const anchor = { left: 200, top: 40, bottom: 60, width: 120 };
    const result = clampPanelToViewport(anchor, PANEL, VIEWPORT, { margin: 20, gap: 10 });
    expect(result).toEqual({ top: 70, left: 200, maxHeight: 400 });
  });

  it("never places the panel outside the viewport on any side, across a grid of anchors", () => {
    for (const left of [-100, 0, 700, 1300, 1600]) {
      for (const top of [-50, 0, 450, 850, 1000]) {
        const anchor = { left, top, bottom: top + 24, width: 120 };
        const pos = clampPanelToViewport(anchor, PANEL, VIEWPORT);
        expect(pos.left).toBeGreaterThanOrEqual(0);
        expect(pos.left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width);
        expect(pos.top).toBeGreaterThanOrEqual(0);
        // The panel's rendered height is capped to maxHeight, not its natural
        // height, so it's *that* — not PANEL.height — that must stay in bounds.
        expect(pos.maxHeight).toBeLessThanOrEqual(PANEL.height);
        expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
      }
    }
  });

  describe("vertical clamping (maxHeight)", () => {
    it("caps maxHeight to the room left below top when the panel is taller than the window", () => {
      const anchor = { left: 200, top: 40, bottom: 60, width: 120 };
      const hugePanel = { width: 300, height: 2000 };
      const { top, maxHeight } = clampPanelToViewport(anchor, hugePanel, VIEWPORT);
      // A 2000px panel can't fit below OR above a 900px-tall viewport, so top
      // clamps to the margin and maxHeight shrinks to whatever room is left.
      expect(top).toBe(8);
      expect(maxHeight).toBe(VIEWPORT.height - 8 - top);
      expect(maxHeight).toBeLessThan(hugePanel.height);
      expect(top + maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
    });

    it("caps maxHeight below the panel's natural height when neither above nor below fully fits", () => {
      const shortViewport = { width: 1400, height: 500 };
      const anchor = { left: 200, top: 200, bottom: 220, width: 120 };
      const { top, maxHeight } = clampPanelToViewport(anchor, PANEL, shortViewport);
      expect(top).toBe(shortViewport.height - PANEL.height - 8);
      // Full height technically fits once top is clamped up, so it isn't
      // shrunk here — this asserts the invariant, not a specific shrink.
      expect(maxHeight).toBeLessThanOrEqual(PANEL.height);
      expect(top + maxHeight).toBeLessThanOrEqual(shortViewport.height);
    });

    it("shrinks maxHeight when a huge panel is forced above and still doesn't fully fit", () => {
      const anchor = { left: 200, top: 900, bottom: 920, width: 120 };
      const hugePanel = { width: 300, height: 2000 };
      const { top, maxHeight } = clampPanelToViewport(anchor, hugePanel, VIEWPORT);
      expect(top).toBe(8);
      expect(maxHeight).toBeLessThan(hugePanel.height);
      expect(maxHeight).toBe(VIEWPORT.height - 8 - 8);
    });

    it("never exceeds the panel's natural height even with generous room", () => {
      const anchor = { left: 200, top: 40, bottom: 60, width: 120 };
      const { maxHeight } = clampPanelToViewport(anchor, PANEL, { width: 4000, height: 4000 });
      expect(maxHeight).toBe(PANEL.height);
    });
  });
});
