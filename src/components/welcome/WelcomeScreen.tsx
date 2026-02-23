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
          ? "bg-blue-600 hover:bg-blue-700 border-blue-600 text-white"
          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm",
        disabled && "opacity-40 cursor-not-allowed hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-none"
      )}
    >
      <span
        className={clsx(
          "mt-0.5 p-2 rounded-lg shrink-0",
          primary
            ? "bg-blue-500"
            : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
        )}
      >
        {icon}
      </span>
      <div>
        <p className={clsx("font-semibold text-sm", primary ? "text-white" : "text-gray-800 dark:text-gray-100")}>
          {title}
        </p>
        <p className={clsx("text-xs mt-0.5", primary ? "text-blue-100" : "text-gray-500 dark:text-gray-400")}>
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 px-8 transition-opacity duration-300 opacity-100">
      <div className="w-full max-w-md flex flex-col items-center gap-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-2xl bg-blue-600 shadow-lg shadow-blue-200 dark:shadow-blue-900">
            <GitBranch className="w-10 h-10 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
              {t("welcome.title")}
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-xs leading-relaxed">
              {t("welcome.description")}
            </p>
          </div>
        </div>

        {/* Action cards */}
        <div className="flex flex-col gap-3 w-full">
          {!isSignedIn && (
            <ActionCard
              icon={<Github className="w-5 h-5 text-white" />}
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
        <p className="text-xs text-gray-400 dark:text-gray-600">
          {t("app.name")} — macOS Git Client
        </p>
      </div>
    </div>
  );
}
