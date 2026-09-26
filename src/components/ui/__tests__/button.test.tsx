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

  // D-medium #4: pointer-events-none이던 시절엔 disabled 버튼이 hover를 아예 받지 못해서
  // title 풍선말(끈 이유)이 뜨지 않았다. cursor-not-allowed로만 「눌러도 소용없다」를 보인다.
  it("keeps a disabled button hoverable (no pointer-events-none) so its title still shows", () => {
    render(
      <Button disabled title="아직 커밋할 것이 없습니다" aria-label="commit">
        Commit
      </Button>,
    );
    const button = screen.getByRole("button", { name: "commit" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toBe("아직 커밋할 것이 없습니다");
    expect(button.className).not.toContain("pointer-events-none");
    expect(button.className).toContain("cursor-not-allowed");
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
