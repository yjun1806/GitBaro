// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterBar } from "@/components/ui/FilterBar";

afterEach(cleanup);

describe("FilterBar", () => {
  it("renders nothing when both slots are empty (no filters to show, e.g. the stash tab)", () => {
    const { container } = render(<FilterBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the left slot alone", () => {
    render(<FilterBar left={<button>lane</button>} />);
    expect(screen.getByRole("button", { name: "lane" })).toBeInTheDocument();
  });

  it("renders the right slot alone", () => {
    render(<FilterBar right={<button>search</button>} />);
    expect(screen.getByRole("button", { name: "search" })).toBeInTheDocument();
  });

  it("renders both slots together, in left-then-right order", () => {
    render(
      <FilterBar
        left={<button>lane</button>}
        right={<button>search</button>}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["lane", "search"]);
  });

  it("is a 36px row with a bottom line, not a card", () => {
    const { container } = render(<FilterBar left={<span>chip</span>} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("h-9");
    expect(bar.className).toContain("border-b");
  });
});
