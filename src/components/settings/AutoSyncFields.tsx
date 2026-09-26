import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { AUTO_SYNC_INTERVALS, AUTO_SYNC_MODES } from "@/lib/auto-sync";
import type { AutoSyncMode, AutoSyncSetting } from "@/types";
import { SettingsRow } from "./ui/SettingsRow";
import { Segmented } from "./ui/Segmented";
import { SettingsSelect } from "./ui/controls";

interface AutoSyncFieldsProps {
  value: AutoSyncSetting;
  onChange: (next: AutoSyncSetting) => void;
  disabled?: boolean;
}

/**
 * 원격 자동 최신화의 방식과 주기 두 줄. 앱 설정(기본값)과 저장소 설정이 같이 쓴다.
 * 「자동으로 받기」를 고르면 언제 받는지 안전 조건을 함께 보인다.
 */
export function AutoSyncFields({ value, onChange, disabled = false }: AutoSyncFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsRow label={t("autoSync.modeLabel")} description={t(`autoSync.modeDescription.${value.mode}`)}>
        <Segmented<AutoSyncMode>
          value={value.mode}
          disabled={disabled}
          onChange={(mode) => onChange({ ...value, mode })}
          options={AUTO_SYNC_MODES.map((mode) => ({ value: mode, label: t(`autoSync.mode.${mode}`) }))}
        />
      </SettingsRow>
      {value.mode === "pull" && (
        <div className="flex items-start gap-2 px-4 py-2.5 text-[11.5px] text-muted-foreground bg-(--acc-faint)">
          <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-success" aria-hidden="true" />
          <span>{t("autoSync.pullSafety")}</span>
        </div>
      )}
      <SettingsRow label={t("autoSync.intervalLabel")}>
        <SettingsSelect
          value={String(value.intervalMinutes)}
          disabled={disabled || value.mode === "off"}
          options={AUTO_SYNC_INTERVALS.map((minutes) => ({
            value: String(minutes),
            label: t("autoSync.interval", { count: minutes }),
          }))}
          onChange={(raw) => {
            const intervalMinutes = AUTO_SYNC_INTERVALS.find((m) => String(m) === raw);
            if (intervalMinutes !== undefined) onChange({ ...value, intervalMinutes });
          }}
        />
      </SettingsRow>
    </>
  );
}
