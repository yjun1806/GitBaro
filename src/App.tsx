import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { addLocalRepository, cloneRepository, getAccounts, getSettings, openRepository } from "@/api/commands";
import { CloneDialog } from "@/components/repository/CloneDialog";
import { AccountSelectDialog } from "@/components/account/AccountSelectDialog";
import i18n from "@/i18n/config";
import { getErrorMessage } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { GhLoginDialog } from "@/components/account/GhLoginDialog";
import { GhAccountDetectedDialog } from "@/components/account/GhAccountDetectedDialog";
import { GhSetupGuard } from "@/components/account/GhSetupGuard";
import { ErrorBoundary } from "@/components/error/ErrorBoundary";
import { ErrorToast } from "@/components/error/ErrorToast";
import { useToastStore } from "@/stores/toast";
import { useGitEvents } from "@/hooks/useGitEvents";
import { useRepoWatcher } from "@/hooks/useRepoWatcher";

function AppContent() {
  const { t } = useTranslation();
  useGitEvents();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  useRepoWatcher(activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const setAccounts = useAccountStore((s) => s.setAccounts);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const theme = useUIStore((s) => s.theme);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const addToast = useToastStore((s) => s.addToast);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showAccountSelectDialog, setShowAccountSelectDialog] = useState(false);
  const [pendingLocalRepo, setPendingLocalRepo] = useState<{ path: string; repoInfo: import("@/types").RepoInfo } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detectedGhAccounts, setDetectedGhAccounts] = useState<import("@/types").GitHubAccount[] | null>(null);

  // Reusable: load accounts from gh CLI and update store
  const refreshAccounts = useCallback(async () => {
    try {
      const loaded = await getAccounts();
      setAccounts(loaded);
      if (loaded.length > 0) {
        const currentId = useAccountStore.getState().activeAccountId;
        const stillExists = loaded.some((a) => a.id === currentId);
        if (!stillExists) {
          setActiveAccount(loaded[0].id);
        }
      }
    } catch (err) {
      addToast(t("error.failedToLoadAccounts", { error: getErrorMessage(err) }), "error");
    }
  }, [setAccounts, setActiveAccount, addToast]);

  // Load accounts and settings from backend on startup
  useEffect(() => {
    const init = async () => {
      await refreshAccounts();

      // If gh accounts were detected but user has no repos (first launch),
      // show the detected accounts dialog so user can choose to link them.
      const currentAccounts = useAccountStore.getState().accounts;
      const currentRepos = useRepositoryStore.getState().repos;
      if (currentAccounts.length > 0 && currentRepos.length === 0) {
        setDetectedGhAccounts(currentAccounts);
      }

      try {
        const settings = await getSettings();
        if (settings.language && settings.language !== i18n.language) {
          i18n.changeLanguage(settings.language);
        }
      } catch {
        // settings load failure is non-critical
      }
    };
    init().finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh persisted repos from backend on startup (to get latest remotes, etc.)
  // Also purge any worktree entries that were incorrectly added as repos.
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  useEffect(() => {
    if (repos.length === 0) return;
    Promise.all(
      repos.map((r) =>
        openRepository(r.path)
          .then((fresh) => {
            if (fresh.isWorktree) {
              removeRepo(r.path);
            } else {
              addRepo({ ...fresh, accountId: r.accountId });
            }
          })
          .catch(() => { /* repo may have been removed from disk */ })
      ),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // DEV: Cmd+Shift+W to preview welcome screen for testing (data preserved)
  const [debugWelcome, setDebugWelcome] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (debugWelcome) {
          // toggle off: return to normal
          setDebugWelcome(false);
          setDetectedGhAccounts(null);
        } else {
          // toggle on: show welcome + detected accounts dialog
          setDebugWelcome(true);
          const accs = useAccountStore.getState().accounts;
          if (accs.length > 0) {
            setDetectedGhAccounts(accs);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [debugWelcome]);

  // Apply theme on change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Watch system theme when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;
    const cleanup = watchSystemTheme(() => {
      applyTheme("system");
    });
    return cleanup;
  }, [theme]);

  const handleSignIn = useCallback(() => {
    setShowLoginDialog(true);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setShowLoginDialog(false);
    refreshAccounts();
  }, [refreshAccounts]);

  const handleClone = useCallback(async (params: { url: string; localPath: string; accountId: string | null }) => {
    const repoInfo = await cloneRepository(params.url, params.localPath, params.accountId ?? undefined);
    const repoWithAccount = params.accountId ? { ...repoInfo, accountId: params.accountId } : repoInfo;
    addRepo(repoWithAccount);
    setActiveRepo(repoInfo.path);
    if (params.accountId) {
      setActiveAccount(params.accountId);
    }
    setShowCloneDialog(false);
    addToast(t("clone.success"), "success");
  }, [addRepo, setActiveRepo, setActiveAccount, addToast, t]);

  const handleOpenLocal = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const dirPath = typeof selected === "string" ? selected : selected;
      const repoInfo = await addLocalRepository(dirPath);

      const currentAccounts = useAccountStore.getState().accounts;
      if (currentAccounts.length >= 2) {
        setPendingLocalRepo({ path: dirPath, repoInfo });
        setShowAccountSelectDialog(true);
      } else {
        const accountId = currentAccounts.length === 1 ? currentAccounts[0].id : null;
        addRepo({ ...repoInfo, accountId });
        setActiveRepo(repoInfo.path);
      }
    } catch (err) {
      addToast(t("error.failedToOpenRepo", { error: getErrorMessage(err) }), "error");
    }
  }, [addRepo, setActiveRepo, addToast]);

  const handleAccountSelectForRepo = useCallback((accountId: string | null) => {
    if (pendingLocalRepo) {
      addRepo({ ...pendingLocalRepo.repoInfo, accountId });
      setActiveRepo(pendingLocalRepo.repoInfo.path);
    }
    setShowAccountSelectDialog(false);
    setPendingLocalRepo(null);
  }, [pendingLocalRepo, addRepo, setActiveRepo]);

  const handleGhDetectedConfirm = useCallback((selected: import("@/types").GitHubAccount[]) => {
    setAccounts(selected);
    if (selected.length > 0) {
      const currentId = useAccountStore.getState().activeAccountId;
      const stillExists = selected.some((a) => a.id === currentId);
      if (!stillExists) {
        setActiveAccount(selected[0].id);
      }
    }
    setDetectedGhAccounts(null);
  }, [setAccounts, setActiveAccount]);

  const handleGhDetectedSignInNew = useCallback(() => {
    setDetectedGhAccounts(null);
    setShowLoginDialog(true);
  }, []);

  // Show loading screen while initial account check runs
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">{t("common.loading")}</div>
      </div>
    );
  }

  const showWelcome = repos.length === 0 || debugWelcome;

  return (
    <>
      {showWelcome ? (
        <WelcomeScreen
          isSignedIn={accounts.length > 0}
          onSignIn={handleSignIn}
          onClone={() => setShowCloneDialog(true)}
          onOpenLocal={handleOpenLocal}
        />
      ) : (
        <MainLayout />
      )}
      {/* Dialog rendered outside conditional to survive welcome→main transition */}
      {showLoginDialog && (
        <GhLoginDialog
          onClose={() => setShowLoginDialog(false)}
          onSuccess={handleLoginSuccess}
        />
      )}
      {showCloneDialog && (
        <CloneDialog
          accounts={accounts}
          selectedAccountId={activeAccountId}
          onAccountChange={setActiveAccount}
          onClone={handleClone}
          onClose={() => setShowCloneDialog(false)}
        />
      )}
      {showAccountSelectDialog && (
        <AccountSelectDialog
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSelect={handleAccountSelectForRepo}
          onClose={() => {
            handleAccountSelectForRepo(null);
          }}
        />
      )}
      {detectedGhAccounts && detectedGhAccounts.length > 0 && (
        <GhAccountDetectedDialog
          accounts={detectedGhAccounts}
          onConfirm={handleGhDetectedConfirm}
          onSignInNew={handleGhDetectedSignInNew}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary fullScreen>
      <GhSetupGuard>
        <AppContent />
      </GhSetupGuard>
      <ErrorToast />
    </ErrorBoundary>
  );
}
