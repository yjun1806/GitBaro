import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Loader2 } from "lucide-react";
import type { NotificationSettings as NotificationSettingsValue } from "@/types";
import { useNotifyStore } from "@/stores/notify";
import { deliverNotification } from "@/lib/notify/deliver";

interface NotificationSettingsProps {
  value: NotificationSettingsValue;
  onChange: (next: NotificationSettingsValue) => void;
}

type ToggleKey = keyof NotificationSettingsValue;

const TOGGLES: { key: ToggleKey; labelKey: string; descriptionKey: string }[] = [
  { key: "newCommits", labelKey: "notify.settings.newCommits", descriptionKey: "notify.settings.newCommitsDescription" },
  { key: "ciFailures", labelKey: "notify.settings.ciFailures", descriptionKey: "notify.settings.ciFailuresDescription" },
  { key: "whenFocused", labelKey: "notify.settings.whenFocused", descriptionKey: "notify.settings.whenFocusedDescription" },
];

/** 설정의 「알림」 칸. 켜고 끄는 즉시 저장하고, 돌고 있는 알림에도 바로 반영한다. */
export function NotificationSettings({ value, onChange }: NotificationSettingsProps) {
  const { t } = useTranslation();
  const setSettings = useNotifyStore((s) => s.setSettings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"system" | "denied" | null>(null);

  const handleToggle = (key: ToggleKey) => {
    const next = { ...value, [key]: !value[key] };
    setSettings(next);
    onChange(next);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 설정 화면을 보는 중이라 앱이 앞에 있다. 토스트가 아니라 시스템 알림을 보내 권한도 함께 확인한다.
      const channel = await deliverNotification(
        { title: t("notify.test.title"), body: t("notify.test.body"), target: null },
        { force: true },
      );
      setTestResult(channel === "denied" ? "denied" : "system");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t("notify.settings.title")}</label>
        <p className="text-xs text-muted-foreground/70">{t("notify.settings.description")}</p>
      </div>

      <div className="flex flex-col gap-1">
        {TOGGLES.map(({ key, labelKey, descriptionKey }) => (
          <label
            key={key}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 cursor-pointer"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-(--acc)"
              checked={value[key]}
              onChange={() => handleToggle(key)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">{t(labelKey)}</span>
              <span className="text-xs text-muted-foreground">{t(descriptionKey)}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {t("notify.test.button")}
        </button>
        {testResult && (
          <p className="text-xs text-muted-foreground">
            {t(testResult === "denied" ? "notify.test.denied" : "notify.test.sent")}
          </p>
        )}
      </div>
    </div>
  );
}
