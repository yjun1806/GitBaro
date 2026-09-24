import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");
/** 라이트 테마의 원천 토큰 블록(`--canvas:`가 든 `:root { … }`부터 다크 테마 앞까지). */
const light = css.slice(css.lastIndexOf(":root {", css.indexOf("--canvas:")), css.indexOf("/* ── Dark 테마 ── */"));

describe("design tokens (plans/design/README.md)", () => {
  it("uses the canvas as the page background and white panels", () => {
    expect(light).toMatch(/--canvas:\s*#f1f1ef;/);
    expect(light).toMatch(/--panel:\s*#ffffff;/);
    expect(css).toMatch(/--background:\s*var\(--canvas\);/);
    expect(css).toMatch(/--card:\s*var\(--panel\);/);
    expect(css).toMatch(/body\s*{\s*@apply bg-background/);
  });

  it("keeps the panel shadow, radius and gap", () => {
    expect(light).toContain("--shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.05);");
    expect(light).toMatch(/--radius-panel:\s*14px;/);
    expect(light).toMatch(/--g:\s*8px;/);
  });
});
