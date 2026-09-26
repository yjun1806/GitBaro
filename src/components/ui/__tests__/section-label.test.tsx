// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectionLabel } from "@/components/ui/PanelHeader";

afterEach(cleanup);

describe("SectionLabel", () => {
  it("has no chevron when it cannot be collapsed", () => {
    render(<SectionLabel title="Commits" />);
    expect(screen.queryByTestId("section-label-chevron")).toBeNull();
  });

  it("shows a chevron pointing down while expanded, and marks the button as expanded", () => {
    render(
      <SectionLabel
        title="Local"
        collapsed={false}
        onToggle={vi.fn()}
        expandLabel="Expand Local"
        collapseLabel="Collapse Local"
      />,
    );
    const button = screen.getByRole("button", { name: "Collapse Local" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const chevron = screen.getByTestId("section-label-chevron");
    expect(chevron.getAttribute("class")).not.toContain("-rotate-90");
  });

  it("rotates the chevron to point sideways while collapsed, and shows the count only then", () => {
    render(
      <SectionLabel
        title="Local"
        count={4}
        collapsed
        onToggle={vi.fn()}
        expandLabel="Expand Local"
        collapseLabel="Collapse Local"
      />,
    );
    const button = screen.getByRole("button", { name: "Expand Local" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("section-label-chevron").getAttribute("class")).toContain("-rotate-90");
    expect(button).toHaveTextContent("4");
  });

  it("does not show the count while expanded", () => {
    render(<SectionLabel title="Local" count={4} collapsed={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).not.toHaveTextContent("4");
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<SectionLabel title="Local" collapsed onToggle={onToggle} expandLabel="Expand" collapseLabel="Collapse" />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
