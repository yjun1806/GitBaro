import { create } from "zustand";
import type { GitHubAccount } from "@/types";

interface AccountState {
  accounts: GitHubAccount[];
  activeAccountId: string | null;
  isAuthenticated: boolean;
  setAccounts: (accounts: GitHubAccount[]) => void;
  setActiveAccount: (id: string | null) => void;
  addAccount: (account: GitHubAccount) => void;
  removeAccount: (id: string) => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  accounts: [],
  activeAccountId: null,
  isAuthenticated: false,

  setAccounts: (accounts) =>
    set({ accounts, isAuthenticated: accounts.length > 0 }),

  setActiveAccount: (id) => set({ activeAccountId: id }),

  addAccount: (account) =>
    set((state) => {
      const exists = state.accounts.some((a) => a.id === account.id);
      const accounts = exists
        ? state.accounts.map((a) => (a.id === account.id ? account : a))
        : [...state.accounts, account];
      return { accounts, isAuthenticated: true };
    }),

  removeAccount: (id) =>
    set((state) => {
      const accounts = state.accounts.filter((a) => a.id !== id);
      const activeAccountId =
        state.activeAccountId === id ? null : state.activeAccountId;
      return { accounts, activeAccountId, isAuthenticated: accounts.length > 0 };
    }),
}));
