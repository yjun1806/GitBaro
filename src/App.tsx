import { useState, useCallback, useEffect, Component, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { addLocalRepository, getAccounts, openRepository } from "@/api/commands";
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-danger">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-md">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary-hover transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- App ---

function AppContent() {
  const accounts = useAccountStore((s) => s.accounts);
  const setAccounts = useAccountStore((s) => s.setAccounts);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const theme = useUIStore((s) => s.theme);

  const addToast = useToastStore((s) => s.addToast);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
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
      addToast(`Failed to load accounts: ${getErrorMessage(err)}`, "error");
    }
  }, [setAccounts, setActiveAccount, addToast]);

  // Load accounts from backend on startup
  useEffect(() => {
    refreshAccounts().finally(() => setIsLoading(false));
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

  const handleOpenLocal = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const dirPath = typeof selected === "string" ? selected : selected;
      const repoInfo = await addLocalRepository(dirPath);
      addRepo(repoInfo);
      setActiveRepo(repoInfo.path);
    } catch (err) {
      addToast(`Failed to open repository: ${getErrorMessage(err)}`, "error");
    }
  }, [addRepo, setActiveRepo, addToast]);

  // Show loading screen while initial account check runs
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  const showWelcome = accounts.length === 0 && repos.length === 0;

  return (
    <>
      {showWelcome ? (
        <WelcomeScreen
          isSignedIn={false}
          onSignIn={handleSignIn}
          onClone={() => {
            // Clone requires auth first — disabled in UI
          }}
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
