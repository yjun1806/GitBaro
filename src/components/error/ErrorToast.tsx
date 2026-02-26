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
    bg: "bg-destructive/90",
    border: "border-destructive/50",
    text: "text-destructive-foreground",
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
    bg: "bg-warning/90",
    border: "border-warning/50",
    text: "text-warning-foreground",
  },
  info: {
    icon: <Info className="w-4 h-4 shrink-0" />,
    bg: "bg-info/90",
    border: "border-info/50",
    text: "text-info-foreground",
  },
  success: {
    icon: <CheckCircle className="w-4 h-4 shrink-0" />,
    bg: "bg-success/90",
    border: "border-success/50",
    text: "text-success-foreground",
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
