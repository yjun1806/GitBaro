import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Terminal, AlertTriangle } from "lucide-react";
import { checkGhStatus } from "@/api/commands";

interface GhSetupGuardProps {
  children: ReactNode;
}

export function GhSetupGuard({ children }: GhSetupGuardProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<
    "loading" | "ok" | "not-installed" | "version-error"
  >("loading");

  useEffect(() => {
    checkGhStatus()
      .then((result) => {
        if (!result.installed) {
          setStatus("not-installed");
        } else if (result.versionError) {
          setStatus("version-error");
        } else {
          setStatus("ok");
        }
      })
      .catch(() => {
        setStatus("not-installed");
      });
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (status === "not-installed") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 p-8 select-none">
        <Terminal className="w-16 h-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">
            {t("gh.notInstalled", "GitHub CLI is not installed")}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            {t(
              "gh.installDescription",
              "GitBaro requires the GitHub CLI (gh) for authentication. Install it to continue.",
            )}
          </p>
        </div>
        <code className="px-4 py-2 bg-muted rounded-lg text-sm font-mono">
          brew install gh
        </code>
        <a
          href="https://cli.github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          cli.github.com
        </a>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
        >
          {t("gh.checkAgain", "Check again")}
        </button>
      </div>
    );
  }

  if (status === "version-error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 p-8 select-none">
        <AlertTriangle className="w-16 h-16 text-amber-500" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">
            {t("gh.versionTooOld", "GitHub CLI needs to be updated")}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            {t(
              "gh.upgradeDescription",
              "GitBaro requires gh version 2.40 or higher. Please upgrade.",
            )}
          </p>
        </div>
        <code className="px-4 py-2 bg-muted rounded-lg text-sm font-mono">
          brew upgrade gh
        </code>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
        >
          {t("gh.checkAgain", "Check again")}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
