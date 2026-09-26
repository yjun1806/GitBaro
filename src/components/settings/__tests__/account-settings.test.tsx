// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import type { GhStatus, GitHubAccount } from "@/types";

const checkGhStatus = vi.fn<() => Promise<GhStatus>>();
vi.mock("@/api/commands", () => ({
  checkGhStatus: () => checkGhStatus(),
}));

const { AccountSettings } = await import("../AccountSettings");

const octo: GitHubAccount = { id: "octo", username: "octo", email: "octo@example.com", avatarUrl: "" };

function renderSettings(accounts: GitHubAccount[] = [octo]) {
  const onSignInAgain = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountSettings
        accounts={accounts}
        onRemove={vi.fn()}
        onAddAccount={vi.fn()}
        onSignInAgain={onSignInAgain}
        onSyncAccounts={vi.fn(async () => {})}
      />
    </QueryClientProvider>,
  );
  return { onSignInAgain };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  checkGhStatus.mockReset();
});
afterEach(cleanup);

describe("AccountSettings", () => {
  it("offers re-login when gh's status list doesn't include the account at all", async () => {
    // e.g. `gh auth logout -u octo` run in a terminal: gh's own account list no
    // longer has this account, distinct from a listed-but-expired ("invalid") one.
    checkGhStatus.mockResolvedValue({ installed: true, version: "2.95.0", loggedIn: true, accounts: [] });
    const { onSignInAgain } = renderSettings();

    await waitFor(() => expect(screen.getByText("Not signed in to gh")).toBeInTheDocument());
    const reLogin = screen.getByRole("button", { name: "Sign in again" });
    fireEvent.click(reLogin);
    expect(onSignInAgain).toHaveBeenCalledWith("octo");
  });

  it("does not claim the account is missing before the gh status query has resolved", () => {
    checkGhStatus.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();

    expect(screen.queryByText("Not signed in to gh")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
  });

  it("keeps showing the existing expired-sign-in state for an account gh does list as invalid", async () => {
    checkGhStatus.mockResolvedValue({
      installed: true,
      version: "2.95.0",
      loggedIn: true,
      accounts: [{ username: "octo", active: true, state: "invalid", scopes: [] }],
    });
    renderSettings();

    await waitFor(() => expect(screen.getByText("Sign-in expired")).toBeInTheDocument());
    expect(screen.queryByText("Not signed in to gh")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
});
