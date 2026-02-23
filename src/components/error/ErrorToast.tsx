import { useEffect, type ReactNode } from "react";
import { X, AlertCircle, AlertTriangle, Info, CheckCircle } from "lucide-react";
import clsx from "clsx";
import { useToastStore, type Toast, type ToastType } from "@/stores/toast";

const toastConfig: Record<
  ToastType,
  { icon: ReactNode; bg: string; border: string; text: string }
> = {
  error: {
    icon: <AlertCircle className="w-4 h-4 shrink-0" />,
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
  },
  info: {
    icon: <Info className="w-4 h-4 shrink-0" />,
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
  },
  success: {
    icon: <CheckCircle className="w-4 h-4 shrink-0" />,
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
    text: "text-green-700 dark:text-green-300",
  },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const config = toastConfig[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      className={clsx(
        "flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full",
        config.bg,
        config.border
      )}
    >
      <span className={clsx("mt-0.5", config.text)}>{config.icon}</span>
      <p className={clsx("flex-1 text-sm", config.text)}>{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className={clsx(
          "p-0.5 rounded transition-colors shrink-0",
          config.text,
          "hover:opacity-70"
        )}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ErrorToast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
