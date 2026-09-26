// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ContextMenu } from "@/components/ui/ContextMenu";

afterEach(cleanup);

function AnchoredHost({ align }: { align?: "start" | "end" }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>trigger</button>
      <ContextMenu
        anchored={{ anchorRef, align }}
        onClose={vi.fn()}
        sections={[{ items: [{ label: "One", onClick: vi.fn() }] }]}
      />
    </>
  );
}

describe("ContextMenu anchored", () => {
  it("renders under the anchor without a fixed click position", () => {
    render(<AnchoredHost />);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "One" })).toBeTruthy();
  });

  it("accepts an end-aligned anchor", () => {
    render(<AnchoredHost align="end" />);
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("ContextMenu item extras", () => {
  it("shows a description as a second line", () => {
    render(
      <ContextMenu
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
        sections={[{ items: [{ label: "Force push", description: "Overwrites the remote branch", onClick: vi.fn() }] }]}
      />,
    );
    const item = screen.getByRole("menuitem", { name: /Force push/ });
    expect(item.textContent).toContain("Overwrites the remote branch");
  });

  it("marks the checked item and leaves the others unmarked", () => {
    render(
      <ContextMenu
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
        sections={[
          {
            items: [
              { label: "Name", checked: true, onClick: vi.fn() },
              { label: "Date", checked: false, onClick: vi.fn() },
            ],
          },
        ]}
      />,
    );
    const name = screen.getByRole("menuitem", { name: "Name" });
    const date = screen.getByRole("menuitem", { name: "Date" });
    expect(name.querySelector("svg")).toBeTruthy();
    expect(date.querySelector("svg")).toBeNull();
  });
});
