// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DialogFrame } from "@/components/ui/DialogFrame";

afterEach(cleanup);

describe("DialogFrame", () => {
  it("names the dialog by its title and renders body/footer", () => {
    const onClose = vi.fn();
    render(
      <DialogFrame title="Delete branch" onClose={onClose} footer={<button>Delete</button>} footerStart={<span>1 commit</span>}>
        <p>This cannot be undone.</p>
      </DialogFrame>,
    );
    expect(screen.getByRole("dialog", { name: "Delete branch" })).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
  });

  it("closes on the header close button and on Escape when dismissible", () => {
    const onClose = vi.fn();
    render(
      <DialogFrame title="Rename branch" onClose={onClose}>
        <p>body</p>
      </DialogFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hides the close button when not dismissible, even with an onClose handler", () => {
    render(
      <DialogFrame title="Working…" onClose={vi.fn()} dismissible={false}>
        <p>please wait</p>
      </DialogFrame>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  // D-low #8: 몸통이 창 높이를 넘으면(긴 파일 목록 등) 창 자체가 뷰포트를 벗어났다 — 몸통만
  // 스크롤되게 창 높이를 가둔다. xl(88vh, 자체 높이 관리)은 그대로 둔다.
  it("caps its own height so the body scrolls, except for xl which sets its own", () => {
    const { rerender } = render(
      <DialogFrame title="t" onClose={vi.fn()}>
        <p>body</p>
      </DialogFrame>,
    );
    expect(screen.getByRole("dialog").className).toContain("max-h-[80vh]");

    rerender(
      <DialogFrame title="t" onClose={vi.fn()} size="xl">
        <p>body</p>
      </DialogFrame>,
    );
    expect(screen.getByRole("dialog").className).not.toContain("max-h-[80vh]");
    expect(screen.getByRole("dialog").className).toContain("h-[88vh]");
  });

  it("does not close on a backdrop click by default, but does when closeOnBackdrop is set", () => {
    const onClose = vi.fn();
    const { container } = render(
      <DialogFrame title="t" onClose={onClose}>
        <p>body</p>
      </DialogFrame>,
    );
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    cleanup();

    const onClose2 = vi.fn();
    const { container: container2 } = render(
      <DialogFrame title="t" onClose={onClose2} closeOnBackdrop>
        <p>body</p>
      </DialogFrame>,
    );
    fireEvent.click(container2.firstElementChild as HTMLElement);
    expect(onClose2).toHaveBeenCalledTimes(1);
  });
});
