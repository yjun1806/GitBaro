import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HEADER_HEIGHT_CLASS, HEADER_HEIGHT_PX } from "@/lib/layout-tokens";
import { toolbarButtonClass, TOOLBAR_BUTTON_BASE, TOOLBAR_GROUP } from "../toolbar-button";

const classes = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

describe("header strip height", () => {
  it("is 44px, and the class matches the constant", () => {
    expect(HEADER_HEIGHT_PX).toBe(44);
    expect(HEADER_HEIGHT_CLASS).toBe(`h-[${HEADER_HEIGHT_PX}px]`);
  });

  it("no element in the strip hard-codes its own strip-sized height", () => {
    const toolbarDir = fileURLToPath(new URL("..", import.meta.url));
    const files = [
      ...readdirSync(toolbarDir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `${toolbarDir}${f}`),
      fileURLToPath(new URL("../../layout/RepoRail.tsx", import.meta.url)),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/52px/);
      // 30px 이상의 고정 높이는 머리 줄 높이를 따로 흉내 내는 것이다. 토큰(HEADER_HEIGHT_CLASS)만 쓴다.
      for (const m of src.matchAll(/\bh-\[(\d+)px\]/g)) {
        expect(Number(m[1]), `${file}: ${m[0]}`).toBeLessThan(30);
      }
    }
  });
});

describe("toolbarButtonClass", () => {
  it("every variant shares the same 28px height, radius, text size and focus ring", () => {
    const variants = [
      toolbarButtonClass(),
      toolbarButtonClass({ open: true }),
      toolbarButtonClass({ disabled: true }),
      toolbarButtonClass({ iconOnly: true }),
      toolbarButtonClass({ variant: "primary" }),
      toolbarButtonClass({ joinRight: true }),
      toolbarButtonClass({ joinLeft: true }),
    ];
    for (const v of variants) {
      for (const c of classes(TOOLBAR_BUTTON_BASE)) expect(classes(v).has(c), `${c} in ${v}`).toBe(true);
      expect(classes(v).has("h-7")).toBe(true);
    }
  });

  it("ghost is grayscale: no brand color, hover fill only when enabled and closed", () => {
    const ghost = toolbarButtonClass();
    expect(ghost).not.toMatch(/primary/);
    expect(classes(ghost).has("hover:bg-(--frame-hover)")).toBe(true);
    expect(classes(ghost).has("px-2")).toBe(true);

    const open = classes(toolbarButtonClass({ open: true }));
    expect(open.has("bg-(--frame-sel)")).toBe(true);
    expect(open.has("hover:bg-(--frame-hover)")).toBe(false);

    const disabled = classes(toolbarButtonClass({ disabled: true }));
    expect(disabled.has("opacity-45")).toBe(true);
    expect(disabled.has("cursor-not-allowed")).toBe(true);
    expect([...disabled].some((c) => c.startsWith("hover:"))).toBe(false);
  });

  it("icon-only is a 28px square; split halves drop the inner corners", () => {
    const icon = classes(toolbarButtonClass({ iconOnly: true }));
    expect(icon.has("w-7")).toBe(true);
    expect(icon.has("px-2")).toBe(false);
    expect(classes(toolbarButtonClass({ joinRight: true })).has("rounded-r-none")).toBe(true);
    expect(classes(toolbarButtonClass({ joinLeft: true })).has("rounded-l-none")).toBe(true);
  });

  it("only the primary variant uses the brand color", () => {
    const primary = classes(toolbarButtonClass({ variant: "primary" }));
    expect(primary.has("bg-primary")).toBe(true);
    expect(primary.has("hover:bg-primary-hover")).toBe(true);
  });
});

describe("toolbar group card", () => {
  it("is a white layer-2 card that fits inside the header strip", () => {
    const group = classes(TOOLBAR_GROUP);
    expect(group.has("bg-card")).toBe(true);
    expect(group.has("shadow-(--shadow-sm)")).toBe(true);
    // 28px 버튼 + 위아래 3px 여백 + 1px 테두리 두 줄
    expect(group.has("p-[3px]")).toBe(true);
    expect(group.has("border")).toBe(true);
    expect(28 + 3 * 2 + 1 * 2).toBeLessThan(HEADER_HEIGHT_PX);
    // 모서리는 버튼 모서리(6px) + 여백(3px)
    expect(group.has("rounded-[9px]")).toBe(true);
  });
});
