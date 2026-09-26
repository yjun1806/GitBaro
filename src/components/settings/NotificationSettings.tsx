import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import type { NotificationSettings as NotificationSettingsValue } from "@/types";
import { useNotifyStore } from "@/stores/notify";
import { deliverNotification } from "@/lib/notify/deliver";
import { SettingsSection } from "./ui/SettingsSection";
import { SettingsRow } from "./ui/SettingsRow";
import { Switch } from "./ui/Switch";
import { SETTINGS_BUTTON } from "./ui/styles";
import { BusyIcon } from "@/components/ui/Spinner";

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

  const handleToggle = (key: ToggleKey, checked: boolean) => {
    const next = { ...value, [key]: checked };
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
    <>
      <SettingsSection description={t("notify.settings.description")}>
        {TOGGLES.map(({ key, labelKey, descriptionKey }) => (
          <SettingsRow key={key} label={t(labelKey)} description={t(descriptionKey)}>
            <Switch checked={value[key]} onChange={(checked) => handleToggle(key, checked)} />
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          label={t("notify.test.button")}
          description={
            testResult ? (
              <span role="status">{t(testResult === "denied" ? "notify.test.denied" : "notify.test.sent")}</span>
            ) : (
              t("notify.test.description")
            )
          }
        >
          <button type="button" onClick={handleTest} disabled={testing} aria-busy={testing} className={SETTINGS_BUTTON}>
            <BusyIcon busy={testing} icon={<Bell className="w-3.5 h-3.5" aria-hidden="true" />} />
            {t("notify.test.send")}
          </button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
