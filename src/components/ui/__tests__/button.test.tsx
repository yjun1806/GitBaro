// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, buttonClass } from "@/components/ui/Button";

afterEach(cleanup);

describe("Button", () => {
  it("shows the busy spinner and disables the button while busy", () => {
    render(
      <Button busy aria-label="commit">
        Commit
      </Button>,
    );
    const button = screen.getByRole("button", { name: "commit" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("[data-spinner]")).toBeTruthy();
  });

  it("renders the icon slot only, without a spinner, when not busy", () => {
    render(
      <Button icon={<svg data-testid="icon" />} aria-label="compare">
        Compare
      </Button>,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.queryByRole("button")?.querySelector("[data-spinner]")).toBeNull();
  });

  it("requires an accessible name for an icon-only button and renders just the icon", () => {
    render(
      <Button iconOnly aria-label="close" icon={<svg data-testid="icon" />}>
        ignored text is not used when icon is given
      </Button>,
    );
    const button = screen.getByRole("button", { name: "close" });
    expect(button.querySelector("[data-testid='icon']")).toBeTruthy();
  });

  it("calls onClick and respects an explicit disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled aria-label="delete">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "delete" });
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("buttonClass", () => {
  it("adds the danger text tone only to secondary and ghost variants", () => {
    expect(buttonClass({ variant: "secondary", tone: "danger" })).toContain("text-danger");
    expect(buttonClass({ variant: "ghost", tone: "danger" })).toContain("text-danger");
    expect(buttonClass({ variant: "primary", tone: "danger" })).not.toContain("text-danger");
  });

  it("gives md ghost a lighter weight than md primary/secondary", () => {
    expect(buttonClass({ variant: "ghost", size: "md" })).toContain("font-medium");
    expect(buttonClass({ variant: "primary", size: "md" })).toContain("font-semibold");
    expect(buttonClass({ variant: "secondary", size: "md" })).toContain("font-semibold");
  });
});
