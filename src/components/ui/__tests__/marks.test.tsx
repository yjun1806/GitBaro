// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Code, Count, Dot, FileStatusLetter, RefLabel, RepoTile, StatusChip } from "@/components/ui/marks";

afterEach(cleanup);

describe("Count", () => {
  it("renders the prefix and value as plain text (no pill)", () => {
    render(<Count value={2} prefix="↑" tone="sync" />);
    expect(screen.getByText("↑2")).toBeTruthy();
  });

  it("exposes an accessible label only when given one", () => {
    const { rerender } = render(<Count value={3} tone="live" label="uncommitted files: 3" />);
    expect(screen.getByRole("img", { name: "uncommitted files: 3" })).toBeTruthy();
    rerender(<Count value={3} tone="live" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("StatusChip", () => {
  it("renders its tone and children", () => {
    render(<StatusChip tone="success">Merged</StatusChip>);
    expect(screen.getByText("Merged")).toBeTruthy();
  });
});

describe("RefLabel", () => {
  it("shows the ref name and uses it as the title", () => {
    render(<RefLabel name="feat/x" kind="local" />);
    const label = screen.getByTitle("feat/x");
    expect(label.textContent).toBe("feat/x");
  });

  it("colors a worktree label from the lane color when given, and falls back to a plain chip otherwise", () => {
    const { getByTitle, rerender } = render(<RefLabel name="wt-1" kind="worktree" laneColor="hsl(200, 50%, 50%)" />);
    expect(getByTitle("wt-1").getAttribute("style")).toContain("--lane-bg");
    expect(getByTitle("wt-1").className).toContain("bg-(--lane-bg)");

    rerender(<RefLabel name="wt-1" kind="worktree" laneColor={null} />);
    expect(getByTitle("wt-1").getAttribute("style")).toBeFalsy();
    expect(getByTitle("wt-1").className).toContain("bg-card");
  });

  it("colors a local branch from the lane color when given (checked out by a worktree)", () => {
    const { getByTitle } = render(<RefLabel name="feat/x" kind="local" laneColor="hsl(200, 50%, 50%)" />);
    expect(getByTitle("feat/x").getAttribute("style")).toContain("--lane-bg");
    expect(getByTitle("feat/x").className).toContain("bg-(--lane-bg)");
  });

  it("keeps the remote outline even when a lane color is given (does not merge with local/worktree)", () => {
    const { getByTitle } = render(<RefLabel name="origin/feat/x" kind="remote" laneColor="hsl(200, 50%, 50%)" />);
    const label = getByTitle("origin/feat/x");
    expect(label.getAttribute("style")).toBeFalsy();
    expect(label.className).toContain("bg-transparent");
    expect(label.className).toContain("border-border");
  });

  it("keeps the bold HEAD outline even when a lane color is given", () => {
    const { getByTitle } = render(<RefLabel name="feat/x" kind="head" laneColor="hsl(200, 50%, 50%)" />);
    const label = getByTitle("feat/x");
    expect(label.getAttribute("style")).toBeFalsy();
    expect(label.className).toContain("border-foreground/50");
    expect(label.className).toContain("font-bold");
  });

  it("renders each kind with a distinct look so local/remote/HEAD/tag/worktree never collide", () => {
    const kinds = ["local", "remote", "head", "tag", "tag-local", "worktree"] as const;
    const classes = kinds.map((kind) => {
      const { getByTitle, unmount } = render(<RefLabel name="x" kind={kind} />);
      const cls = getByTitle("x").className;
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(kinds.length);
  });

  it("uses a custom title over the name when given (e.g. a local-only tag)", () => {
    render(<RefLabel name="v1" kind="tag-local" title="v1 (local only)" />);
    expect(screen.getByTitle("v1 (local only)").textContent).toBe("v1");
  });
});

describe("RepoTile", () => {
  it("renders the repo's initial and is hidden from assistive tech (the name is read by sibling text)", () => {
    const { container } = render(<RepoTile name="gitbaro" color={{ background: "red", foreground: "white" }} size="md" />);
    const tile = container.querySelector("[aria-hidden='true']");
    expect(tile?.textContent).toBe("G");
  });
});

describe("Dot", () => {
  it("uses the live color when on and muted when off", () => {
    const { container, rerender } = render(<Dot on />);
    expect(container.querySelector("span")?.className).toContain("bg-(--live)");
    rerender(<Dot on={false} />);
    expect(container.querySelector("span")?.className).toContain("bg-muted-foreground");
  });

  it("shows no pulse ring and fades the static halo out via a transition when not live", () => {
    const { container } = render(<Dot on />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("transition-shadow");
    expect(outer?.className).not.toContain("shadow-[0_0_0_3px_var(--live-soft)]");
    expect(outer?.querySelector('[data-testid="dot-pulse"]')).toBeNull();
  });

  it("shows a static halo and a pulse ring child while live", () => {
    const { container } = render(<Dot on live pulseKey={1} />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("shadow-[0_0_0_3px_var(--live-soft)]");
    const ring = outer?.querySelector('[data-testid="dot-pulse"]');
    expect(ring).toBeTruthy();
    expect(ring?.className).toContain("animate-live-ring");
  });

  it("remounts the pulse ring (a new DOM node) only when pulseKey moves forward", () => {
    const { container, rerender } = render(<Dot on live pulseKey={1} />);
    const first = container.querySelector('[data-testid="dot-pulse"]');
    // Same pulseKey, same forced re-render: the ring must not remount (React keeps the node).
    rerender(<Dot on live pulseKey={1} />);
    expect(container.querySelector('[data-testid="dot-pulse"]')).toBe(first);
    // A new pulseKey (changedAt moved forward) remounts a fresh node so the animation replays.
    rerender(<Dot on live pulseKey={2} />);
    const second = container.querySelector('[data-testid="dot-pulse"]');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe("Code", () => {
  it("renders inline by default and as a block when asked", () => {
    const { rerender, container } = render(<Code>git status</Code>);
    expect(screen.getByText("git status").tagName).toBe("CODE");
    rerender(<Code block>git status</Code>);
    expect(container.querySelector("code")?.className).toContain("block");
  });
});

describe("FileStatusLetter", () => {
  it("shows the one-letter status with a matching accessible name", () => {
    render(<FileStatusLetter status="modified" />);
    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Modified" })).toBeTruthy();
  });

  it("gives conflicted and ignored the same glyph but different colors", () => {
    const { container: c1 } = render(<FileStatusLetter status="conflicted" />);
    const { container: c2 } = render(<FileStatusLetter status="ignored" />);
    expect(c1.textContent).toBe("!");
    expect(c2.textContent).toBe("!");
    expect(c1.querySelector("span")?.className).toContain("text-danger");
    expect(c2.querySelector("span")?.className).toContain("text-muted-foreground");
  });
});
