// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import type { SidebarTreeData } from "@/components/sidebar/useSidebarTreeData";
import { HiddenSidebarLead } from "../SidebarToggle";
import { isSidebarToggleShortcut, useSidebarToggleShortcut } from "../useSidebarToggleShortcut";
import { RepoRail } from "../RepoRail";
import { Dialog } from "@/components/ui/Dialog";

// 사이드바 안의 트리·설정 조회는 Tauri를 부른다. 여기서는 머리 줄과 숨김 상태만 본다.
vi.mock("@/components/sidebar/RepoTree", () => ({ RepoTree: () => <div>repo-tree</div> }));
vi.mock("@/components/sidebar/useSidebarTreeData", () => ({
  useSidebarTreeData: () => ({}) as SidebarTreeData,
}));
vi.mock("@/hooks/useSelectRepo", () => ({ useSelectRepo: () => ({ selectRepo: vi.fn(), fetchingPath: null }) }));
vi.mock("@/api/queries", () => ({ useSettings: () => ({ data: null }) }));

beforeAll(async () => {
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
  useUIStore.setState({ sidebarHidden: false });
});

function ShortcutHost() {
  useSidebarToggleShortcut();
  return <input aria-label="field" />;
}

function pressKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

describe("sidebar toggle in the sidebar header", () => {
  it("hides the sidebar from its header button and slides the panel out", () => {
    const { container } = render(<RepoRail width={276} />);
    const panel = container.querySelector("[data-sidebar-panel]") as HTMLElement;
    expect(panel.hasAttribute("inert")).toBe(false);
    expect((container.firstElementChild as HTMLElement).style.width).toBe("276px");

    fireEvent.click(screen.getByRole("button", { name: "사이드바 숨기기" }));

    expect(useUIStore.getState().sidebarHidden).toBe(true);
    // 흐름 폭은 0이 되고, 패널은 마운트된 채 화면 밖으로 밀리며 포커스를 받지 않는다.
    expect((container.firstElementChild as HTMLElement).style.width).toBe("0px");
    expect(panel.className).toContain("-translate-x-full");
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(screen.getByText("repo-tree")).toBeTruthy();
  });

  it("keeps keyboard focus on the toggle as it moves between the sidebar and the toolbar", () => {
    // 숨긴 사이드바는 inert라, 그 안의 버튼에 있던 포커스가 body로 떨어지면 안 된다.
    render(
      <>
        <div data-testid="toolbar">
          <HiddenSidebarLead />
        </div>
        <div data-testid="sidebar">
          <RepoRail width={276} />
        </div>
      </>,
    );
    const toggleIn = (id: string) => within(screen.getByTestId(id)).getByRole("button", { name: /사이드바/ });
    toggleIn("sidebar").focus();
    fireEvent.click(toggleIn("sidebar"));
    expect(document.activeElement).toBe(toggleIn("toolbar"));

    fireEvent.click(toggleIn("toolbar"));
    expect(document.activeElement).toBe(toggleIn("sidebar"));
  });

  it("turns off the slide under reduced motion", () => {
    const { container } = render(<RepoRail width={276} />);
    const panel = container.querySelector("[data-sidebar-panel]") as HTMLElement;
    expect(panel.className).toContain("motion-reduce:transition-none");
    expect(panel.className).toContain("transition-transform");
  });
});

describe("HiddenSidebarLead (start of the toolbar)", () => {
  it("renders nothing while the sidebar is shown, so the toolbar has no traffic-light inset", () => {
    const { container } = render(<HiddenSidebarLead />);
    expect(container.querySelector("[data-traffic-light-inset]")).toBeNull();
    expect(screen.queryByRole("button", { name: "사이드바 보이기" })).toBeNull();
  });

  it("reserves the traffic-light inset and shows the button while the sidebar is hidden", () => {
    useUIStore.setState({ sidebarHidden: true });
    const { container } = render(<HiddenSidebarLead />);
    const inset = container.querySelector("[data-traffic-light-inset]") as HTMLElement;
    expect(inset).not.toBeNull();
    expect(inset.style.width).toBe("92px");
    expect(inset.hasAttribute("data-tauri-drag-region")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "사이드바 보이기" }));
    expect(useUIStore.getState().sidebarHidden).toBe(false);
    expect(container.querySelector("[data-traffic-light-inset]")).toBeNull();
  });
});

describe("⌘\\ shortcut", () => {
  it("toggles the sidebar", () => {
    render(<ShortcutHost />);
    pressKey({ key: "\\", code: "Backslash", metaKey: true });
    expect(useUIStore.getState().sidebarHidden).toBe(true);
    pressKey({ key: "\\", code: "Backslash", metaKey: true });
    expect(useUIStore.getState().sidebarHidden).toBe(false);
  });

  it("does nothing while a modal dialog is open", () => {
    render(
      <>
        <ShortcutHost />
        <Dialog ariaLabel="settings">
          <button type="button">ok</button>
        </Dialog>
      </>,
    );
    pressKey({ key: "\\", code: "Backslash", metaKey: true });
    expect(useUIStore.getState().sidebarHidden).toBe(false);
  });

  it("works on a Korean keyboard layout, where the key reports ₩", () => {
    render(<ShortcutHost />);
    pressKey({ key: "₩", code: "Backslash", metaKey: true });
    expect(useUIStore.getState().sidebarHidden).toBe(true);
  });

  it("ignores the key without ⌘ or with other modifiers", () => {
    render(<ShortcutHost />);
    pressKey({ key: "\\", code: "Backslash" });
    pressKey({ key: "\\", code: "Backslash", metaKey: true, shiftKey: true });
    pressKey({ key: "\\", code: "Backslash", ctrlKey: true });
    expect(useUIStore.getState().sidebarHidden).toBe(false);
  });

  it("matches only ⌘\\", () => {
    const base = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isSidebarToggleShortcut({ ...base, key: "\\", code: "Backslash" })).toBe(true);
    expect(isSidebarToggleShortcut({ ...base, key: "b", code: "KeyB" })).toBe(false);
    expect(isSidebarToggleShortcut({ ...base, altKey: true, key: "\\", code: "Backslash" })).toBe(false);
  });
});
