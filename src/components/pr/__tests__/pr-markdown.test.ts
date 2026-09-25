// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrMarkdown } from "../pr-markdown";

function dom(source: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = renderPrMarkdown(source);
  return div;
}

describe("renderPrMarkdown", () => {
  it("renders GitHub-flavoured basics", () => {
    const el = dom("Adds a **login** form.\nSecond line\n\n- [x] done\n\n`code`");
    expect(el.querySelector("strong")?.textContent).toBe("login");
    // 코멘트처럼 줄바꿈이 그대로 줄바꿈이다.
    expect(el.querySelector("br")).not.toBeNull();
    expect(el.querySelector("code")?.textContent).toBe("code");
  });

  it("drops scripts, event handlers and dangerous URLs", () => {
    const el = dom(
      [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "[click](javascript:alert(1))",
        '<a href="data:text/html,hi">data</a>',
        "<iframe src=https://evil.example></iframe>",
      ].join("\n\n"),
    );
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.innerHTML).not.toContain("onerror");
    for (const a of el.querySelectorAll("a")) expect(a.getAttribute("href") ?? "").not.toMatch(/^(javascript|data):/i);
  });

  it("drops markup that could cover or imitate the app", () => {
    const el = dom(
      '<div style="position:fixed;inset:0" class="fixed inset-0 z-50" id="app">cover</div>\n\n<form><input name="password"><button>Sign in</button></form>',
    );
    expect(el.innerHTML).not.toContain("style=");
    expect(el.innerHTML).not.toContain("class=");
    expect(el.innerHTML).not.toContain('id="app"');
    expect(el.querySelector("form, input, button")).toBeNull();
  });

  it("drops <style> elements anywhere in the body, including inside svg", () => {
    // <style>은 속성이 아니라 요소라 FORBID_ATTR로는 걸리지 않는다. 본문 중간이나 <svg> 안의 <style>은
    // 앱 전체의 스타일을 바꾼다(예: 모든 요소를 숨김).
    const el = dom(
      [
        "hi",
        "<style>*{visibility:hidden}</style>",
        "<svg><style>body{background:red}</style></svg>",
        "<math><mi>x</mi></math>",
        '<link rel="stylesheet" href="https://evil.example/x.css">',
      ].join("\n\n"),
    );
    expect(el.querySelector("style")).toBeNull();
    expect(el.innerHTML).not.toContain("visibility:hidden");
    expect(el.innerHTML).not.toContain("background:red");
    expect(el.querySelector("svg, math, link")).toBeNull();
    expect(el.textContent).toContain("hi");
  });

  it("keeps https links, mailto and https images", () => {
    const el = dom("[docs](https://example.com/x) <mailto:a@example.com>\n\n![logo](https://example.com/logo.png)");
    expect(el.querySelector('a[href="https://example.com/x"]')).not.toBeNull();
    expect(el.querySelector('a[href="mailto:a@example.com"]')).not.toBeNull();
    expect(el.querySelector('img[src="https://example.com/logo.png"]')).not.toBeNull();
  });
});
