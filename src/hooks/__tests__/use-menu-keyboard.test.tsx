// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";

afterEach(cleanup);

function Menu({ ready }: { ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeyboard(ref, vi.fn(), ready);
  return (
    <div ref={ref} role="menu" tabIndex={-1}>
      <button role="menuitem">First</button>
      <button role="menuitem">Second</button>
    </div>
  );
}

// D-high #2: ContextMenu의 anchored 메뉴는 자리를 재기 전까지 visibility: hidden이다. 숨은 동안
// 포커스를 주면 브라우저가 무시하고, 자리를 잡은 뒤에는 아무도 다시 포커스를 주지 않아 메뉴가 열려도
// 키보드가 첫 항목에 닿지 않았다. `ready`가 false인 동안은 포커스를 미루고, true가 되면 그제서야 준다.
describe("useMenuKeyboard focus timing", () => {
  it("does not move focus while not ready (menu not positioned/visible yet)", () => {
    document.body.innerHTML = '<button id="opener">open</button>';
    const opener = document.getElementById("opener") as HTMLButtonElement;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    render(<Menu ready={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it("focuses the first menu item once the menu becomes ready", () => {
    document.body.innerHTML = '<button id="opener">open</button>';
    (document.getElementById("opener") as HTMLButtonElement).focus();

    const { rerender } = render(<Menu ready={false} />);
    expect(document.activeElement?.textContent).not.toBe("First");

    rerender(<Menu ready={true} />);
    expect(document.activeElement?.textContent).toBe("First");
  });

  it("focuses immediately when ready from the first render (fixed-position menus)", () => {
    render(<Menu ready={true} />);
    expect(document.activeElement?.textContent).toBe("First");
  });
});
