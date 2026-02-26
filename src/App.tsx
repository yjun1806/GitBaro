import { useState, useCallback, useEffect, Component, type ReactNode } from "react";
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
import { GhSetupGuard } from "@/components/account/GhSetupGuard";
import { ErrorToast } from "@/components/error/ErrorToast";
import { useToastStore } from "@/stores/toast";

// --- Error Boundary ---
interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : i18n.t("error.unknownError");
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-danger">{i18n.t("error.somethingWentWrong")}</p>
          <p className="text-sm text-muted-foreground max-w-md">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary-hover transition-colors"
          >
            {i18n.t("error.tryAgain")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- App ---

function AppContent() {
  const { t } = useTranslation();
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
  useEffect(() => {
    if (repos.length === 0) return;
    Promise.all(
      repos.map((r) =>
        openRepository(r.path)
          .then((fresh) => addRepo({ ...fresh, accountId: r.accountId }))
          .catch(() => { /* repo may have been removed from disk */ })
      ),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Show loading screen while initial account check runs
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">{t("common.loading")}</div>
      </div>
    );
  }

  const showWelcome = accounts.length === 0 && repos.length === 0;

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
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GhSetupGuard>
        <AppContent />
      </GhSetupGuard>
      <ErrorToast />
    </ErrorBoundary>
  );
}
