import type { ReactNode } from "react";
import { GitBranch, Github, FolderOpen, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

interface WelcomeScreenProps {
  isSignedIn: boolean;
  onSignIn: () => void;
  onClone: () => void;
  onOpenLocal: () => void;
}

interface ActionCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  primary = false,
  disabled = false,
}: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex items-start gap-4 w-full p-5 rounded-xl border text-left transition-all duration-150",
        primary
          ? "bg-primary hover:bg-primary-hover border-primary text-primary-foreground"
          : "bg-card border-border text-foreground hover:border-primary hover:shadow-sm",
        disabled && "opacity-40 cursor-not-allowed hover:border-border hover:shadow-none"
      )}
    >
      <span
        className={clsx(
          "mt-0.5 p-2 rounded-lg shrink-0",
          primary
            ? "bg-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <div>
        <p className={clsx("font-semibold text-sm", primary ? "text-primary-foreground" : "text-foreground")}>
          {title}
        </p>
        <p className={clsx("text-xs mt-0.5", primary ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {description}
        </p>
      </div>
    </button>
  );
}

export function WelcomeScreen({
  isSignedIn,
  onSignIn,
  onClone,
  onOpenLocal,
}: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-surface px-8 transition-opacity duration-300 opacity-100">
      <div className="w-full max-w-md flex flex-col items-center gap-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-2xl bg-primary shadow-lg shadow-primary/20">
            <GitBranch className="w-10 h-10 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">
              {t("welcome.title")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-xs leading-relaxed">
              {t("welcome.description")}
            </p>
          </div>
        </div>

        {/* Action cards */}
        <div className="flex flex-col gap-3 w-full">
          {!isSignedIn && (
            <ActionCard
              icon={<Github className="w-5 h-5 text-primary-foreground" />}
              title={t("welcome.signIn")}
              description="Connect your GitHub account to get started"
              onClick={onSignIn}
              primary
            />
          )}

          <ActionCard
            icon={<Download className="w-5 h-5" />}
            title={t("welcome.clone")}
            description="Clone a repository from GitHub or a URL"
            onClick={onClone}
            disabled={!isSignedIn}
          />

          <ActionCard
            icon={<FolderOpen className="w-5 h-5" />}
            title={t("welcome.openLocal")}
            description="Open an existing local Git repository"
            onClick={onOpenLocal}
          />
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/50">
          {t("app.name")} — macOS Git Client
        </p>
      </div>
    </div>
  );
}
