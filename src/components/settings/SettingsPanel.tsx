import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { AppSettings, GitHubAccount } from "@/types";
import { ThemeSelector } from "./ThemeSelector";
import { AccountSettings } from "./AccountSettings";

interface SettingsPanelProps {
  settings: AppSettings;
  accounts: GitHubAccount[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRemoveAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onClose: () => void;
}

type Section = "accounts" | "appearance" | "editor" | "shell" | "advanced";

const sections: { id: Section; labelKey: string }[] = [
  { id: "accounts", labelKey: "settings.accounts" },
  { id: "appearance", labelKey: "settings.appearance" },
  { id: "editor", labelKey: "settings.editor" },
  { id: "shell", labelKey: "settings.shell" },
];

export function SettingsPanel({
  settings,
  accounts,
  onUpdateSettings,
  onRemoveAccount,
  onAddAccount,
  onClose,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Section>("accounts");

  const toggle = (section: Section) => {
    setExpanded((prev) => (prev === section ? "accounts" : section));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
          {sections.map(({ id, labelKey }) => (
            <div
              key={id}
              className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => toggle(id)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t(labelKey)}
                <ChevronDown
                  className={clsx(
                    "w-4 h-4 text-gray-400 transition-transform",
                    expanded === id && "rotate-180"
                  )}
                />
              </button>

              {expanded === id && (
                <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800">
                  {id === "accounts" && (
                    <AccountSettings
                      accounts={accounts}
                      onRemove={onRemoveAccount}
                      onAddAccount={onAddAccount}
                    />
                  )}

                  {id === "appearance" && (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          {t("settings.theme")}
                        </label>
                        <ThemeSelector
                          value={settings.theme}
                          onChange={(theme) => onUpdateSettings({ theme })}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          {t("settings.language")}
                        </label>
                        <select
                          value={settings.language}
                          onChange={(e) => onUpdateSettings({ language: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="en">English</option>
                          <option value="ko">한국어</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {id === "editor" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {t("settings.editor")}
                      </label>
                      <input
                        type="text"
                        value={settings.defaultEditor}
                        onChange={(e) => onUpdateSettings({ defaultEditor: e.target.value })}
                        placeholder="code, vim, nano..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {id === "shell" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {t("settings.shell")}
                      </label>
                      <input
                        type="text"
                        value={settings.defaultShell}
                        onChange={(e) => onUpdateSettings({ defaultShell: e.target.value })}
                        placeholder="zsh, bash, fish..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
