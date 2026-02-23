import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle, XCircle, Copy, ExternalLink } from "lucide-react";
import { startDeviceFlow, pollDeviceFlow } from "@/api/commands";
import { useAccountStore } from "@/stores/account";
import type { DeviceFlowStart, DeviceFlowPollResult } from "@/api/commands";

type FlowState = "idle" | "code" | "polling" | "success" | "error";

interface DeviceFlowDialogProps {
  onClose: () => void;
}

export function DeviceFlowDialog({ onClose }: DeviceFlowDialogProps) {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [deviceData, setDeviceData] = useState<DeviceFlowStart | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [successAccount, setSuccessAccount] = useState<{
    username: string;
    email: string;
  } | null>(null);

  const addAccount = useAccountStore((s) => s.addAccount);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const pollingRef = useRef(false);

  const startFlow = useCallback(async () => {
    try {
      setFlowState("idle");
      setErrorMessage("");
      setCopied(false);
      const data = await startDeviceFlow();
      setDeviceData(data);
      setFlowState("code");
    } catch (err) {
      setErrorMessage(String(err));
      setFlowState("error");
    }
  }, []);

  // Start flow on mount
  useEffect(() => {
    startFlow();
  }, [startFlow]);

  // Poll after user clicks "I've entered the code"
  const startPolling = useCallback(async () => {
    if (!deviceData || pollingRef.current) return;
    pollingRef.current = true;
    setFlowState("polling");

    const interval = (deviceData.interval || 5) * 1000;
    const expiresAt = Date.now() + deviceData.expires_in * 1000;

    while (pollingRef.current && Date.now() < expiresAt) {
      try {
        const result: DeviceFlowPollResult = await pollDeviceFlow(
          deviceData.device_code,
        );

        if (result.status === "success" && result.account) {
          addAccount({
            id: result.account.id,
            username: result.account.username,
            email: result.account.email,
            avatarUrl: result.account.avatarUrl,
            tokenExpiresAt: null,
          });
          setActiveAccount(result.account.id);
          setSuccessAccount({
            username: result.account.username,
            email: result.account.email,
          });
          setFlowState("success");
          pollingRef.current = false;
          return;
        }

        if (result.status === "expired_token") {
          setErrorMessage("Code expired. Please try again.");
          setFlowState("error");
          pollingRef.current = false;
          return;
        }

        if (result.status === "access_denied") {
          setErrorMessage("Access denied by user.");
          setFlowState("error");
          pollingRef.current = false;
          return;
        }

        // authorization_pending or slow_down — keep polling
        if (result.status === "slow_down") {
          await new Promise((r) => setTimeout(r, interval + 5000));
        } else {
          await new Promise((r) => setTimeout(r, interval));
        }
      } catch (err) {
        setErrorMessage(String(err));
        setFlowState("error");
        pollingRef.current = false;
        return;
      }
    }

    if (pollingRef.current) {
      setErrorMessage("Code expired. Please try again.");
      setFlowState("error");
      pollingRef.current = false;
    }
  }, [deviceData, addAccount, setActiveAccount]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  const handleCopyCode = async () => {
    if (!deviceData) return;
    await navigator.clipboard.writeText(deviceData.user_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenGitHub = async () => {
    if (!deviceData) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(deviceData.verification_uri);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-5">
        {/* Requesting code */}
        {flowState === "idle" && (
          <>
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-sm text-muted">Connecting to GitHub...</p>
          </>
        )}

        {/* Show user code */}
        {flowState === "code" && deviceData && (
          <>
            <div className="text-center">
              <p className="text-sm text-muted mb-1">
                Enter this code on GitHub
              </p>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-2 mx-auto px-4 py-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <span className="text-2xl font-mono font-bold tracking-widest">
                  {deviceData.user_code}
                </span>
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-muted" />
                )}
              </button>
              {copied && (
                <p className="text-xs text-green-500 mt-1">Copied!</p>
              )}
            </div>

            <button
              onClick={handleOpenGitHub}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="w-4 h-4" />
              Open github.com/login/device
            </button>

            <button
              onClick={startPolling}
              className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              I've entered the code
            </button>

            <button
              onClick={onClose}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {/* Polling */}
        {flowState === "polling" && (
          <>
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Waiting for authorization...
              </p>
              <p className="text-xs text-muted mt-1">
                Complete the sign-in on GitHub
              </p>
            </div>
            <button
              onClick={() => {
                pollingRef.current = false;
                onClose();
              }}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {/* Success */}
        {flowState === "success" && successAccount && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500" />
            <div className="text-center">
              <p className="font-semibold">
                Signed in as {successAccount.username}
              </p>
              <p className="text-sm text-muted mt-1">
                {successAccount.email}
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Continue
            </button>
          </>
        )}

        {/* Error */}
        {flowState === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-500" />
            <div className="text-center">
              <p className="font-semibold">Authentication failed</p>
              {errorMessage && (
                <p className="text-sm text-muted mt-1">{errorMessage}</p>
              )}
            </div>
            <button
              onClick={startFlow}
              className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Try again
            </button>
            <button
              onClick={onClose}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
