// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// D-high #1: SyncZone/SortMenu/RepoListView는 트리거 버튼의 onClick에서 `open`을 그대로 토글한다.
// 메뉴가 트리거를 「바깥」으로 세면, 같은 클릭의 mousedown이 먼저 닫고 뒤따르는 click의 토글이
// 다시 열어서 트리거로는 절대 닫을 수 없었다.
function ToggleHost() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen((v) => !v)}>
        trigger
      </button>
      {open && (
        <ContextMenu
          anchored={{ anchorRef }}
          onClose={() => setOpen(false)}
          sections={[{ items: [{ label: "One", onClick: vi.fn() }] }]}
        />
      )}
    </>
  );
}

describe("ContextMenu anchored outside-click", () => {
  it("closes on a second real click (mousedown then click) on the same trigger that opened it", () => {
    render(<ToggleHost />);
    const trigger = screen.getByRole("button", { name: "trigger" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    // A real click is mousedown → mouseup → click, in that order.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still closes on a mousedown elsewhere (the ordinary outside-click case)", () => {
    render(<ToggleHost />);
    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
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
