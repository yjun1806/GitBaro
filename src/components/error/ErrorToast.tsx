import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X, AlertCircle, AlertTriangle, Info, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useToastStore, type Toast, type ToastType } from "@/stores/toast";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { Button } from "@/components/ui/Button";

const toastConfig: Record<ToastType, { icon: ReactNode; iconClass: string }> = {
  error: { icon: <AlertCircle className="w-4 h-4 shrink-0" />, iconClass: "text-danger" },
  warning: { icon: <AlertTriangle className="w-4 h-4 shrink-0" />, iconClass: "text-warning" },
  info: { icon: <Info className="w-4 h-4 shrink-0" />, iconClass: "text-info" },
  success: { icon: <CheckCircle className="w-4 h-4 shrink-0" />, iconClass: "text-success" },
};

/** 알림이 흐려지며 사라지는 시간(ms). globals.css의 --motion-fast와 같다. 끝나면 목록에서 뺀다. */
const TOAST_EXIT_MS = 120;

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const { t } = useTranslation();
  const config = toastConfig[toast.type];
  const [leaving, setLeaving] = useState(false);
  const dismiss = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const timer = setTimeout(dismiss, 5000);
    return () => clearTimeout(timer);
  }, [dismiss]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onRemove(toast.id), TOAST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, toast.id, onRemove]);

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 rounded-(--radius-item) max-w-sm w-full",
        FLOATING_SURFACE,
        leaving ? "animate-toast-out pointer-events-none" : "animate-toast-in",
      )}
    >
      <span className={cn("mt-0.5", config.iconClass)}>{config.icon}</span>
      <p className="flex-1 text-[12.5px] text-foreground">{toast.message}</p>
      <Button iconOnly size="sm" variant="ghost" onClick={dismiss} aria-label={t("common.close")}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export function ErrorToast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  // 라이브 리전 칸 자체는 비어 있어도 계속 DOM에 남긴다. 알림이 없을 때 통째로 없어졌다가 다시
  // 생기면 스크린리더가 그 칸을 라이브 리전으로 다시 등록하지 못해 다음 알림을 놓칠 수 있다.
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
