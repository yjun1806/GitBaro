import { useTranslation } from "react-i18next";
import {
  Copy,
  FolderOpen,
  Terminal,
  Globe,
  Code2,
  Bot,
  Trash2,
} from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";
import { revealInFinder, openInTerminal, openRepoInEditor, openAiCliInTerminal } from "@/api/commands";
import { getGitHubWebUrl } from "@/lib/utils";
import type { RepoInfo, AppSettings } from "@/types";

const AI_CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  aider: "Aider",
  copilot: "Copilot CLI",
};

const EDITOR_DISPLAY_NAMES: Record<string, string> = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  kiro: "Kiro",
  zed: "Zed",
  sublime: "Sublime Text",
  webstorm: "WebStorm",
  intellij: "IntelliJ IDEA",
  fleet: "Fleet",
  xcode: "Xcode",
  nova: "Nova",
  textmate: "TextMate",
  android_studio: "Android Studio",
  phpstorm: "PhpStorm",
  rubymine: "RubyMine",
  goland: "GoLand",
  rider: "Rider",
};

interface RepoHeaderContextMenuProps {
  repo: RepoInfo;
  settings: AppSettings | null;
  position: { x: number; y: number };
  onRemove: () => void;
  onClose: () => void;
}

export function RepoHeaderContextMenu({
  repo,
  settings,
  position,
  onRemove,
  onClose,
}: RepoHeaderContextMenuProps) {
  const { t } = useTranslation();

  const gitHubUrl = repo.remotes
    .map((r) => getGitHubWebUrl(r.url))
    .find((url) => url !== null) ?? null;

  const editorId = settings?.defaultEditor ?? "";
  const editorName = EDITOR_DISPLAY_NAMES[editorId] ?? "";
  const hasEditor = editorId !== "" && editorName !== "";

  const aiCliId = settings?.defaultAiCli ?? "";
  const aiCliName = AI_CLI_DISPLAY_NAMES[aiCliId] ?? "";
  const hasAiCli = aiCliId !== "" && aiCliName !== "";

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("repo.contextMenu.copyName"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            navigator.clipboard.writeText(repo.name);
          },
        },
        {
          label: t("repo.contextMenu.copyPath"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            navigator.clipboard.writeText(repo.path);
          },
        },
      ],
    },
    {
      items: [
        {
          label: t("repo.contextMenu.viewOnGitHub"),
          icon: <Globe className="w-3.5 h-3.5" />,
          onClick: () => {
            if (gitHubUrl) {
              openUrl(gitHubUrl);
            }
          },
          disabled: !gitHubUrl,
        },
        {
          label: t("repo.contextMenu.openInTerminal"),
          icon: <Terminal className="w-3.5 h-3.5" />,
          onClick: () => {
            openInTerminal(repo.path);
          },
        },
        {
          label: t("repo.contextMenu.revealInFinder"),
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onClick: () => {
            revealInFinder(repo.path);
          },
        },
        {
          label: hasEditor
            ? t("repo.contextMenu.openInEditor", { editor: editorName })
            : t("repo.contextMenu.openInEditorFallback"),
          icon: <Code2 className="w-3.5 h-3.5" />,
          onClick: () => {
            openRepoInEditor(repo.path);
          },
          disabled: !hasEditor,
        },
        {
          label: hasAiCli
            ? t("repo.contextMenu.openAiCli", { cli: aiCliName })
            : t("repo.contextMenu.openAiCliFallback"),
          icon: <Bot className="w-3.5 h-3.5" />,
          onClick: () => {
            openAiCliInTerminal(repo.path, aiCliId);
          },
          disabled: !hasAiCli,
        },
      ],
    },
    {
      items: [
        {
          label: t("repo.contextMenu.remove"),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          variant: "danger" as const,
          onClick: async () => {
            const confirmed = await ask(
              t("repo.contextMenu.removeConfirmDetail", { name: repo.name }),
              {
                title: t("repo.contextMenu.removeConfirmTitle"),
                kind: "warning",
              },
            );
            if (confirmed) {
              onRemove();
            }
          },
        },
      ],
    },
  ];

  return (
    <ContextMenu sections={sections} position={position} onClose={onClose} />
  );
}
