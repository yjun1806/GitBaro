import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Terminal, AlertTriangle } from "lucide-react";
import { checkGhStatus } from "@/api/commands";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";

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
    return <LoadingState className="h-screen" />;
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
        <Code block>brew install gh</Code>
        <a
          href="https://cli.github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          cli.github.com
        </a>
        <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
          {t("gh.checkAgain", "Check again")}
        </Button>
      </div>
    );
  }

  if (status === "version-error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 p-8 select-none">
        <AlertTriangle className="w-16 h-16 text-warning" />
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
        <Code block>brew upgrade gh</Code>
        <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
          {t("gh.checkAgain", "Check again")}
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
