import { useState, useEffect } from "react";
import { X, Users, Palette, Code, Check, Loader2, Terminal, Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { AppSettings, GitHubAccount, EditorInfo, TerminalInfo, AiCliInfo } from "@/types";
import { Select } from "@/components/ui/Select";
import { detectInstalledEditors, detectInstalledTerminals, detectInstalledAiClis } from "@/api/commands";
import { ThemeSelector } from "./ThemeSelector";
import { AccountSettings } from "./AccountSettings";

const AI_CLI_ICONS: Record<string, { bg: string; svg: React.ReactNode }> = {
  claude: {
    bg: "bg-[#D97757]/15",
    svg: (
      <svg viewBox="0 0 16 16" fill="#D97757" className="w-[18px] h-[18px]">
        <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
      </svg>
    ),
  },
  codex: {
    bg: "bg-[#10A37F]/15",
    svg: (
      <svg viewBox="0 0 16 16" fill="#10A37F" className="w-[18px] h-[18px]">
        <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/>
      </svg>
    ),
  },
  gemini: {
    bg: "bg-[#4285F4]/15",
    svg: (
      <svg viewBox="0 0 24 24" fill="#4285F4" className="w-[18px] h-[18px]">
        <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/>
      </svg>
    ),
  },
  aider: {
    bg: "bg-[#4264EA]/15",
    svg: (
      <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
        <path d="M4 17L10 12L4 7" stroke="#4264EA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 17H20" stroke="#4264EA" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  copilot: {
    bg: "bg-[#171717]/10 dark:bg-[#f0f0f0]/15",
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] text-[#171717] dark:text-[#f0f0f0]">
        <path d="M4 18v-5.5c0 -.667 .167 -1.333 .5 -2"/>
        <path d="M12 7.5c0 -1 -.01 -4.07 -4 -3.5c-3.5 .5 -4 2.5 -4 3.5c0 1.5 0 4 3 4c4 0 5 -2.5 5 -4"/>
        <path d="M4 12c-1.333 .667 -2 1.333 -2 2c0 1 0 3 1.5 4c3 2 6.5 3 8.5 3s5.499 -1 8.5 -3c1.5 -1 1.5 -3 1.5 -4c0 -.667 -.667 -1.333 -2 -2"/>
        <path d="M20 18v-5.5c0 -.667 -.167 -1.333 -.5 -2"/>
        <path d="M12 7.5l0 -.297l.01 -.269l.027 -.298l.013 -.105l.033 -.215c.014 -.073 .029 -.146 .046 -.22l.06 -.223c.336 -1.118 1.262 -2.237 3.808 -1.873c2.838 .405 3.703 1.797 3.93 2.842l.036 .204c0 .033 .01 .066 .013 .098l.016 .185l0 .171l0 .49l-.015 .394l-.02 .271c-.122 1.366 -.655 2.845 -2.962 2.845c-3.256 0 -4.524 -1.656 -4.883 -3.081l-.053 -.242a3.865 3.865 0 0 1 -.036 -.235l-.021 -.227a3.518 3.518 0 0 1 -.007 -.215l.005 0"/>
        <path d="M10 15v2"/>
        <path d="M14 15v2"/>
      </svg>
    ),
  },
};

function AiCliIcon({ cliId }: { cliId: string }) {
  const item = AI_CLI_ICONS[cliId];
  if (item) {
    return (
      <div className={clsx("w-7 h-7 rounded-md flex items-center justify-center shrink-0", item.bg)}>
        {item.svg}
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-muted text-muted-foreground shrink-0">
      <Bot className="w-4 h-4" />
    </div>
  );
}

function AppIcon({ icon, name }: { icon: string | null; name: string }) {
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="w-7 h-7 rounded-md shrink-0"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-muted text-muted-foreground text-xs font-bold shrink-0">
      {name.charAt(0)}
    </div>
  );
}

interface SettingsPanelProps {
  settings: AppSettings;
  accounts: GitHubAccount[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRemoveAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onSyncAccounts: () => Promise<void>;
  onClose: () => void;
}

type Section = "accounts" | "appearance" | "editor" | "terminal" | "ai";

const sections: { id: Section; labelKey: string; icon: typeof Users }[] = [
  { id: "accounts", labelKey: "settings.accounts", icon: Users },
  { id: "appearance", labelKey: "settings.appearance", icon: Palette },
  { id: "editor", labelKey: "settings.editor", icon: Code },
  { id: "terminal", labelKey: "settings.terminal", icon: Terminal },
  { id: "ai", labelKey: "settings.ai", icon: Bot },
];

export function SettingsPanel({
  settings,
  accounts,
  onUpdateSettings,
  onRemoveAccount,
  onAddAccount,
  onSyncAccounts,
  onClose,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>("accounts");
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  const [editorsLoading, setEditorsLoading] = useState(false);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [terminalsLoading, setTerminalsLoading] = useState(false);
  const [aiClis, setAiClis] = useState<AiCliInfo[]>([]);
  const [aiClisLoading, setAiClisLoading] = useState(false);

  useEffect(() => {
    if (activeSection === "editor") {
      setEditorsLoading(true);
      detectInstalledEditors()
        .then(setEditors)
        .catch(() => setEditors([]))
        .finally(() => setEditorsLoading(false));
    }
    if (activeSection === "terminal") {
      setTerminalsLoading(true);
      detectInstalledTerminals()
        .then(setTerminals)
        .catch(() => setTerminals([]))
        .finally(() => setTerminalsLoading(false));
    }
    if (activeSection === "ai") {
      setAiClisLoading(true);
      detectInstalledAiClis()
        .then(setAiClis)
        .catch(() => setAiClis([]))
        .finally(() => setAiClisLoading(false));
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
                onSyncAccounts={onSyncAccounts}
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
                  <Select
                    value={settings.language}
                    options={[
                      { value: "en", label: "English" },
                      { value: "ko", label: "한국어" },
                    ]}
                    onChange={(val) => onUpdateSettings({ language: val })}
                    className="max-w-xs"
                  />
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
                          <AppIcon icon={editor.icon} name={editor.name} />
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

            {activeSection === "terminal" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("settings.terminal")}
                  </label>
                  <p className="text-xs text-muted-foreground/70">
                    {t("settings.terminalDescription")}
                  </p>
                </div>

                {terminalsLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("settings.detectingTerminals")}
                  </div>
                ) : terminals.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t("settings.noTerminals")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {terminals.map((terminal) => (
                      <button
                        key={terminal.id}
                        onClick={() =>
                          onUpdateSettings({ defaultShell: terminal.id })
                        }
                        className={clsx(
                          "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                          settings.defaultShell === terminal.id
                            ? "bg-accent text-foreground ring-1 ring-ring"
                            : "text-foreground hover:bg-accent/50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <AppIcon icon={terminal.icon} name={terminal.name} />
                          <span className="font-medium">{terminal.name}</span>
                        </div>
                        {settings.defaultShell === terminal.id && (
                          <Check className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "ai" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("settings.ai")}
                  </label>
                  <p className="text-xs text-muted-foreground/70">
                    {t("settings.aiDescription")}
                  </p>
                </div>

                {aiClisLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("settings.detectingAiClis")}
                  </div>
                ) : aiClis.filter((c) => c.installed).length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t("settings.noAiClis")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {aiClis
                      .filter((cli) => cli.installed)
                      .map((cli) => (
                        <button
                          key={cli.id}
                          onClick={() =>
                            onUpdateSettings({ defaultAiCli: cli.id })
                          }
                          className={clsx(
                            "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                            settings.defaultAiCli === cli.id
                              ? "bg-accent text-foreground ring-1 ring-ring"
                              : "text-foreground hover:bg-accent/50"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <AiCliIcon cliId={cli.id} />
                            <span className="font-medium">{cli.name}</span>
                          </div>
                          {settings.defaultAiCli === cli.id && (
                            <Check className="w-4 h-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
