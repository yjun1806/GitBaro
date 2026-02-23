import { useState, useCallback, useEffect, Component, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { startOAuth, addLocalRepository } from "@/api/commands";
import { MainLayout } from "@/components/layout/MainLayout";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { OAuthDialog } from "@/components/account/OAuthDialog";

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
type OAuthState = "idle" | "loading" | "success" | "error";

function AppContent() {
  const accounts = useAccountStore((s) => s.accounts);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const theme = useUIStore((s) => s.theme);

  const [oauthState, setOauthState] = useState<OAuthState>("idle");
  const [oauthError, setOauthError] = useState("");

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

  const handleSignIn = useCallback(async () => {
    setOauthState("loading");
    setOauthError("");
    try {
      const { authUrl } = await startOAuth();
      // Open auth URL in default browser
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(authUrl);
      // For now, keep loading state — real flow needs a callback listener
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : String(err));
      setOauthState("error");
    }
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
      console.error("Failed to open local repository:", err);
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
        {oauthState !== "idle" && (
          <OAuthDialog
            state={oauthState as "loading" | "success" | "error"}
            errorMessage={oauthError}
            onRetry={handleSignIn}
            onClose={() => setOauthState("idle")}
            onDeviceCode={() => setOauthState("idle")}
          />
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
    </ErrorBoundary>
  );
}
