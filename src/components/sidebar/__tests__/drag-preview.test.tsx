// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { DragPreview } from "../TreeDnd";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

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
});
