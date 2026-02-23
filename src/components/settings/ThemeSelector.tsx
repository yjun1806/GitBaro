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
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
          )}
        >
          {opt.icon}
          <span>{t(opt.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
