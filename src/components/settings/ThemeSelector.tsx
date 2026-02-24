import type { ReactNode } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { Theme } from "@/types";

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

interface ThemeOption {
  value: Theme;
  labelKey: string;
  icon: ReactNode;
}

const options: ThemeOption[] = [
  { value: "light", labelKey: "settings.light", icon: <Sun className="w-4 h-4" /> },
  { value: "dark", labelKey: "settings.dark", icon: <Moon className="w-4 h-4" /> },
  { value: "system", labelKey: "settings.system", icon: <Monitor className="w-4 h-4" /> },
];

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            "flex flex-col items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium transition-all",
            value === opt.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-border hover:bg-accent"
          )}
        >
          {opt.icon}
          <span>{t(opt.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
