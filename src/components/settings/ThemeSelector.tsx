import { Sun, Moon, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/types";
import { Segmented } from "./ui/Segmented";

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

const ICON = "w-3.5 h-3.5";

/** 라이트·다크·시스템 중 고르기. 설정 줄(`SettingsRow`) 안에 둔다. */
export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const { t } = useTranslation();
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: "light", label: t("settings.light"), icon: <Sun className={ICON} aria-hidden="true" /> },
        { value: "dark", label: t("settings.dark"), icon: <Moon className={ICON} aria-hidden="true" /> },
        { value: "system", label: t("settings.system"), icon: <Monitor className={ICON} aria-hidden="true" /> },
      ]}
    />
  );
}
