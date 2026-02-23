import { useState, useCallback, useEffect, Component, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { addLocalRepository, getAccounts } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { DeviceFlowDialog } from "@/components/account/DeviceFlowDialog";
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
          <p className="text-sm text-muted max-w-md">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
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
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const theme = useUIStore((s) => s.theme);

  const addToast = useToastStore((s) => s.addToast);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  // Load accounts from backend on startup
  useEffect(() => {
    getAccounts().then((loaded) => {
      setAccounts(loaded);
      if (loaded.length > 0) {
        const stillExists = loaded.some((a) => a.id === activeAccountId);
        if (!stillExists) {
          setActiveAccount(loaded[0].id);
        }
      }
    }).catch((err) => {
      addToast(`Failed to load accounts: ${getErrorMessage(err)}`, "error");
    });
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
  }, [addRepo, setActiveRepo]);

  const showWelcome = accounts.length === 0 && repos.length === 0;

  if (showWelcome) {
    return (
      <>
        <WelcomeScreen
          isSignedIn={false}
          onSignIn={handleSignIn}
          onClone={() => {
            // Clone requires auth first — disabled in UI
          }}
          onOpenLocal={handleOpenLocal}
        />
        {showLoginDialog && (
          <DeviceFlowDialog onClose={() => setShowLoginDialog(false)} />
        )}
      </>
    );
  }

  return <MainLayout />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <ErrorToast />
    </ErrorBoundary>
  );
}
