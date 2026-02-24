import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2, CheckCircle, XCircle, Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { startGhLogin } from "@/api/commands";

type FlowState = "idle" | "code" | "waiting" | "success" | "error";

interface GhLoginDialogProps {
  onClose: () => void;
  /** Called when login completes successfully, after user clicks Continue. */
  onSuccess?: (username: string) => void;
}

export function GhLoginDialog({ onClose, onSuccess }: GhLoginDialogProps) {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [userCode, setUserCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successUsername, setSuccessUsername] = useState("");

  const startLogin = useCallback(async () => {
    setFlowState("idle");
    setErrorMessage("");
    setCopied(false);

    try {
      await startGhLogin();
      // Command returned — background task is running.
      // We wait for Tauri events to update the UI.
    } catch (err) {
      setErrorMessage(String(err));
      setFlowState("error");
    }
  }, []);

  // Set up Tauri event listeners, then start login
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    let mounted = true;

    async function setup() {
      const unlisten1 = await listen<{ userCode: string; verificationUri: string }>(
        "gh-login:device-code",
        (event) => {
          if (!mounted) return;
          setUserCode(event.payload.userCode);
          setFlowState("code");
        },
      );
      cleanups.push(unlisten1);

      const unlisten2 = await listen<{ username: string }>(
        "gh-login:complete",
        (event) => {
          if (!mounted) return;
          setSuccessUsername(event.payload.username);
          setFlowState("success");
          // Account refresh is deferred to onClose/onSuccess to avoid
          // unmounting the dialog mid-flow (parent re-renders when accounts change).
        },
      );
      cleanups.push(unlisten2);

      const unlisten3 = await listen<{ message: string }>(
        "gh-login:error",
        (event) => {
          if (!mounted) return;
          setErrorMessage(event.payload.message);
          setFlowState("error");
        },
      );
      cleanups.push(unlisten3);

      if (!mounted) return;
      await startLogin();
    }

    setup();

    return () => {
      mounted = false;
      cleanups.forEach((fn) => fn());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenGitHub = async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://github.com/login/device");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-5">
        {/* Requesting code */}
        {flowState === "idle" && (
          <>
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {t("account.connecting", "Connecting to GitHub...")}
            </p>
          </>
        )}

        {/* Show user code */}
        {flowState === "code" && (
          <>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">
                {t("account.enterCode", "Enter this code on GitHub")}
              </p>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-2 mx-auto px-4 py-3 bg-muted rounded-lg hover:bg-accent transition-colors"
              >
                <span className="text-2xl font-mono font-bold tracking-widest">
                  {userCode}
                </span>
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              {copied && (
                <p className="text-xs text-success mt-1">
                  {t("account.copied", "Copied!")}
                </p>
              )}
            </div>

            <button
              onClick={handleOpenGitHub}
              className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="w-4 h-4" />
              {t("account.openGitHub", "Open github.com/login/device")}
            </button>

            <p className="text-xs text-muted-foreground text-center">
              {t(
                "account.waitingAuth",
                "Waiting for authorization... Complete the sign-in on GitHub.",
              )}
            </p>

            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("common.cancel")}
            </button>
          </>
        )}

        {/* Waiting (after code shown, browser opened) */}
        {flowState === "waiting" && (
          <>
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium">
                {t("account.waitingAuth", "Waiting for authorization...")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "account.completeSignIn",
                  "Complete the sign-in on GitHub",
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("common.cancel")}
            </button>
          </>
        )}

        {/* Success */}
        {flowState === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-success" />
            <div className="text-center">
              <p className="font-semibold">
                {t("account.signedInAs", "Signed in as")} {successUsername}
              </p>
            </div>
            <button
              onClick={() => {
                onSuccess?.(successUsername);
                onClose();
              }}
              className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium rounded-lg transition-colors"
            >
              {t("account.continue", "Continue")}
            </button>
          </>
        )}

        {/* Error */}
        {flowState === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive" />
            <div className="text-center">
              <p className="font-semibold">
                {t("error.auth", "Authentication failed")}
              </p>
              {errorMessage && (
                <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
              )}
            </div>
            <button
              onClick={startLogin}
              className="w-full px-5 py-2.5 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium rounded-lg transition-colors"
            >
              {t("error.retry", "Retry")}
            </button>
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
