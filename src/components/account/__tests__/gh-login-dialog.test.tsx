// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
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
  startGhLogin: vi.fn(async () => 7),
  cancelGhLogin: vi.fn(async () => {}),
}));

import { listen } from "@tauri-apps/api/event";
import { cancelGhLogin, startGhLogin } from "@/api/commands";
import { GhLoginDialog } from "@/components/account/GhLoginDialog";

afterEach(() => {
  cleanup();
  handlers.clear();
  vi.mocked(cancelGhLogin).mockClear();
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

  it("cancels the running gh login when the dialog closes", async () => {
    const { unmount } = render(<GhLoginDialog onClose={vi.fn()} />);

    await vi.waitFor(() => expect(startGhLogin).toHaveBeenCalled());
    await act(async () => {});
    unmount();

    expect(cancelGhLogin).toHaveBeenCalledWith(7);
  });

  it("leaves no listener behind after StrictMode's first cleanup and a real unmount", async () => {
    let active = 0;
    vi.mocked(listen).mockImplementation((async () => {
      await Promise.resolve();
      active += 1;
      return () => {
        active -= 1;
      };
    }) as unknown as typeof listen);

    const { unmount } = render(
      <StrictMode>
        <GhLoginDialog onClose={vi.fn()} />
      </StrictMode>,
    );
    await vi.waitFor(() => expect(startGhLogin).toHaveBeenCalled());
    await act(async () => {});
    expect(active).toBe(3);
    unmount();
    expect(active).toBe(0);
  });
});
