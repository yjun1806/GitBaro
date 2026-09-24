// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

vi.mock("@/api/commands", () => ({
  startGhLogin: vi.fn(async () => {}),
}));

import { GhLoginDialog } from "@/components/account/GhLoginDialog";

afterEach(() => {
  cleanup();
  handlers.clear();
});

describe("GhLoginDialog", () => {
  it("runs onSuccess when the success screen is dismissed with Escape", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<GhLoginDialog onClose={onClose} onSuccess={onSuccess} />);

    await vi.waitFor(() => expect(handlers.has("gh-login:complete")).toBe(true));
    act(() => handlers.get("gh-login:complete")?.({ payload: { username: "octo" } }));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onSuccess).toHaveBeenCalledWith("octo");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not run onSuccess when an unfinished flow is dismissed", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<GhLoginDialog onClose={onClose} onSuccess={onSuccess} />);

    await vi.waitFor(() => expect(handlers.has("gh-login:device-code")).toBe(true));
    act(() =>
      handlers.get("gh-login:device-code")?.({
        payload: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
      }),
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
