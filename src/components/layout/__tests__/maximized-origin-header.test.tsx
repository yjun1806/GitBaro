// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { MaximizedOriginHeader } from "../MaximizedOriginHeader";
import type { MaximizedOrigin } from "../maximized-files";

afterEach(cleanup);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("MaximizedOriginHeader", () => {
  it("shows the source, title and meta for a commit origin, and names the group for assistive tech", () => {
    const origin: MaximizedOrigin = {
      kind: "commit",
      label: <span data-testid="origin-label">c4cbaa5</span>,
      title: "fix(layout): one 8px gutter on both sides of the sidebar line",
      meta: "YJun · 12m ago",
    };
    render(<MaximizedOriginHeader origin={origin} onRestore={vi.fn()} />);
    expect(screen.getByTestId("origin-label")).toBeTruthy();
    expect(screen.getByText(origin.title as string)).toBeTruthy();
    expect(screen.getByText("YJun · 12m ago")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Commit" })).toBeTruthy();
  });

  it("skips the title/meta lines when an origin has none (e.g. a follow origin with no commit title)", () => {
    const origin: MaximizedOrigin = {
      kind: "follow",
      label: <span data-testid="origin-label">Uncommitted changes</span>,
    };
    const { container } = render(<MaximizedOriginHeader origin={origin} onRestore={vi.fn()} />);
    expect(container.querySelector(".font-bold")).toBeNull();
    expect(screen.getByRole("group", { name: "Uncommitted changes (following)" })).toBeTruthy();
  });

  it("calls onRestore when the restore button is pressed, and its title mentions Esc", () => {
    const onRestore = vi.fn();
    render(<MaximizedOriginHeader origin={{ kind: "pr", label: <span>#42</span> }} onRestore={onRestore} />);
    const button = screen.getByRole("button", { name: "Restore size" });
    expect(button.getAttribute("title")).toMatch(/Esc/);
    fireEvent.click(button);
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("gives every origin kind a distinct icon so the kind is readable at a glance", () => {
    const kinds: MaximizedOrigin["kind"][] = ["working", "follow", "commit", "stash", "range", "pr", "fileTouches"];
    const icons = kinds.map((kind) => {
      const { container, unmount } = render(<MaximizedOriginHeader origin={{ kind, label: <span>x</span> }} onRestore={vi.fn()} />);
      const svg = container.querySelector("svg");
      const cls = svg?.getAttribute("class") ?? "";
      unmount();
      return cls;
    });
    // "working" and "follow" intentionally share the same uncommitted-changes icon (2.6: same meaning, same shape).
    expect(new Set(icons).size).toBe(kinds.length - 1);
  });
});
