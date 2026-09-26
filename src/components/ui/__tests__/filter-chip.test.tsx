// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { FilterChip } from "@/components/ui/FilterChip";

afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("FilterChip toggle", () => {
  it("reflects on/off through aria-pressed and calls onClick", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FilterChip pressed={false} onClick={onClick}>
        xms-app
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "xms-app" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <FilterChip pressed onClick={onClick}>
        xms-app
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "xms-app" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an optional swatch and count", () => {
    render(
      <FilterChip pressed swatchColor="#be3f72" count={<span data-testid="cnt">● 3</span>}>
        review-worktree
      </FilterChip>,
    );
    expect(screen.getByTestId("filter-chip-swatch")).toBeInTheDocument();
    expect(screen.getByTestId("cnt")).toHaveTextContent("● 3");
  });

  it("locks: keeps aria-disabled + a title reason, but does not use native disabled (hover title stays reachable) and blocks the click", () => {
    const onClick = vi.fn();
    render(
      <FilterChip pressed onClick={onClick} locked title="기본 폴더는 늘 보여요">
        main
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "main" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).toHaveAttribute("title", "기본 폴더는 늘 보여요");
    expect(chip).not.toBeDisabled();
    expect(chip.className).not.toContain("pointer-events-none");
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("FilterChip removable (compare chip variant)", () => {
  it("renders the body as a non-button (avoids nesting a button) with a trailing × that fires onRemove", () => {
    const onRemove = vi.fn();
    render(
      <FilterChip pressed onRemove={onRemove}>
        main..feat/x
      </FilterChip>,
    );
    expect(screen.queryByRole("button", { name: "main..feat/x" })).toBeNull();
    expect(screen.getByText("main..feat/x")).toBeInTheDocument();
    const removeButton = screen.getByRole("button", { name: i18n.t("filters.removeChip") });
    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom removeLabel that overrides the default", () => {
    render(
      <FilterChip pressed onRemove={vi.fn()} removeLabel="End comparing">
        main..feat/x
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "End comparing" })).toBeInTheDocument();
  });
});
