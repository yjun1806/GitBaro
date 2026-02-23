import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";

type OAuthState = "loading" | "success" | "error";

interface OAuthDialogProps {
  state: OAuthState;
  account?: GitHubAccount;
  errorMessage?: string;
  onRetry: () => void;
  onClose: () => void;
  onDeviceCode: () => void;
}

export function OAuthDialog({
  state,
  account,
  errorMessage,
  onRetry,
  onClose,
  onDeviceCode,
}: OAuthDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-6">
        {state === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <p className="text-gray-700 dark:text-gray-200 text-center font-medium">
              Connecting to GitHub...
            </p>
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {state === "success" && account && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500" />
            <div className="text-center">
              <p className="font-semibold text-gray-800 dark:text-gray-100">
                Signed in as {account.username}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {account.email}
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Continue
            </button>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-500" />
            <div className="text-center">
              <p className="font-semibold text-gray-800 dark:text-gray-100">
                Authentication failed
              </p>
              {errorMessage && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {errorMessage}
                </p>
              )}
            </div>
            <div className="flex flex-col items-center gap-3 w-full">
              <button
                onClick={onRetry}
                className="w-full px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("error.retry")}
              </button>
              <button
                onClick={onDeviceCode}
                className="text-sm text-blue-500 hover:underline"
              >
                Having trouble? Use Device Code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
