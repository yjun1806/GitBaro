// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { DragPreview } from "../TreeDnd";
import { useRepositoryStore } from "@/stores/repository";
import { avatarColorFromHue } from "@/lib/avatar-color";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  useRepositoryStore.setState({ repoPrefs: {} });
});

describe("DragPreview", () => {
  const data = { kind: "repo" as const, label: "api", path: "/r/api" };

  it("says the account is not loaded yet when that is why the drop is blocked", () => {
    render(<DragPreview data={data} blockedReason="account-pending" />);
    expect(screen.getByRole("status").textContent).toBe(i18n.t("sidebarDnd.accountPending"));
  });

  it("says the target belongs to another account", () => {
    render(<DragPreview data={data} blockedReason="account-mismatch" />);
    expect(screen.getByRole("status").textContent).toBe(i18n.t("sidebarDnd.otherAccount"));
  });

  it("shows no reason when the drop is allowed", () => {
    render(<DragPreview data={data} blockedReason={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses the avatar color picked in the repository settings", () => {
    useRepositoryStore.setState({ repoPrefs: { "/r/api": { hue: 150 } } });
    const { container } = render(<DragPreview data={data} blockedReason={null} />);
    const tile = container.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    const expected = document.createElement("span");
    expected.style.backgroundColor = avatarColorFromHue(150).background;
    expect(tile.style.backgroundColor).toBe(expected.style.backgroundColor);
  });
});
