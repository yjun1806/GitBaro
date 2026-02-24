import { useState, useEffect } from "react";
import { X, Users, Palette, Code, Terminal, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { AppSettings, GitHubAccount, EditorInfo } from "@/types";
import { detectInstalledEditors } from "@/api/commands";
import { ThemeSelector } from "./ThemeSelector";
import { AccountSettings } from "./AccountSettings";

function EditorIcon({ editor }: { editor: EditorInfo }) {
  if (editor.icon) {
    return (
      <img
        src={editor.icon}
        alt={editor.name}
        className="w-7 h-7 rounded-md shrink-0"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-muted text-muted-foreground text-xs font-bold shrink-0">
      {editor.name.charAt(0)}
    </div>
  );
}

interface SettingsPanelProps {
  settings: AppSettings;
  accounts: GitHubAccount[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRemoveAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onClose: () => void;
}

type Section = "accounts" | "appearance" | "editor" | "shell";

const sections: { id: Section; labelKey: string; icon: typeof Users }[] = [
  { id: "accounts", labelKey: "settings.accounts", icon: Users },
  { id: "appearance", labelKey: "settings.appearance", icon: Palette },
  { id: "editor", labelKey: "settings.editor", icon: Code },
  { id: "shell", labelKey: "settings.shell", icon: Terminal },
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
  const [activeSection, setActiveSection] = useState<Section>("accounts");
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  const [editorsLoading, setEditorsLoading] = useState(false);

  useEffect(() => {
    if (activeSection === "editor") {
      setEditorsLoading(true);
      detectInstalledEditors()
        .then(setEditors)
        .catch(() => setEditors([]))
        .finally(() => setEditorsLoading(false));
    }
  }, [activeSection]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-[180px] shrink-0 border-r border-border py-3 px-2 flex flex-col gap-0.5">
            {sections.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={clsx(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                  activeSection === id
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(labelKey)}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === "accounts" && (
              <AccountSettings
                accounts={accounts}
                onRemove={onRemoveAccount}
                onAddAccount={onAddAccount}
              />
            )}

            {activeSection === "appearance" && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("settings.theme")}
                  </label>
                  <ThemeSelector
                    value={settings.theme}
                    onChange={(theme) => onUpdateSettings({ theme })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("settings.language")}
                  </label>
                  <select
                    value={settings.language}
                    onChange={(e) =>
                      onUpdateSettings({ language: e.target.value })
                    }
                    className="w-full max-w-xs px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="en">English</option>
                    <option value="ko">한국어</option>
                  </select>
                </div>
              </div>
            )}

            {activeSection === "editor" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("settings.editor")}
                  </label>
                  <p className="text-xs text-muted-foreground/70">
                    {t("settings.editorDescription")}
                  </p>
                </div>

                {editorsLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("settings.detecting")}
                  </div>
                ) : editors.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t("settings.noEditors")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {editors.map((editor) => (
                      <button
                        key={editor.id}
                        onClick={() =>
                          onUpdateSettings({ defaultEditor: editor.id })
                        }
                        className={clsx(
                          "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                          settings.defaultEditor === editor.id
                            ? "bg-accent text-foreground ring-1 ring-ring"
                            : "text-foreground hover:bg-accent/50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <EditorIcon editor={editor} />
                          <span className="font-medium">{editor.name}</span>
                        </div>
                        {settings.defaultEditor === editor.id && (
                          <Check className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "shell" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("settings.shell")}
                </label>
                <input
                  type="text"
                  value={settings.defaultShell}
                  onChange={(e) =>
                    onUpdateSettings({ defaultShell: e.target.value })
                  }
                  placeholder="zsh, bash, fish..."
                  className="w-full max-w-xs px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
