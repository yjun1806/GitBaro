import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, FolderOpen } from "lucide-react";
import { getAppVersion, getEnvironmentInfo } from "@/api/commands";
import { useMenuActions } from "@/hooks/useMenuActions";
import type { EnvironmentInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";

/** 버전과 경로 한 줄. 경로가 있으면 복사 버튼을 단다. */
function ToolLine({ version, path, missing }: { version: string | null; path: string | null; missing: string }) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  if (!version && !path) return <span className="text-[12.5px] text-muted-foreground">{missing}</span>;
  return (
    <span className="flex items-center gap-1.5 min-w-0 text-[12.5px] text-foreground">
      {version && <span className="font-semibold">{version}</span>}
      {path && (
        <>
          <Code className="truncate" title={path}>
            {path}
          </Code>
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onClick={() => actions.copy(path)}
            aria-label={t("settingsPanel.copyPath")}
            title={t("settingsPanel.copyPath")}
          >
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </>
      )}
    </span>
  );
}

/** 「정보」 칸: 앱 버전, 찾은 git·gh, 설정 파일 위치. */
export function AboutSection() {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const [version, setVersion] = useState<string | null>(null);
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [envFailed, setEnvFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getAppVersion()
      .then((v) => alive && setVersion(v))
      .catch(() => {
        /* 버전을 못 읽으면 줄을 비워 둔다 */
      });
    getEnvironmentInfo()
      .then((info) => alive && setEnv(info))
      .catch(() => alive && setEnvFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const pending = !env && !envFailed;
  const missing = pending ? t("settingsPanel.about.checking") : t("settingsPanel.about.notFound");

  return (
    <SettingsSection>
      <SettingsRow label={t("settingsPanel.about.version")}>
        <span className="text-[12.5px] font-semibold text-foreground">{version ?? "—"}</span>
      </SettingsRow>
      <SettingsRow label="git" description={t("settingsPanel.about.gitDescription")}>
        <ToolLine version={env?.gitVersion ?? null} path={env?.gitPath ?? null} missing={missing} />
      </SettingsRow>
      <SettingsRow label="GitHub CLI (gh)" description={t("settingsPanel.about.ghDescription")}>
        <ToolLine version={env?.ghVersion ?? null} path={env?.ghPath ?? null} missing={missing} />
      </SettingsRow>
      <SettingsRow
        stacked
        label={t("settingsPanel.about.settingsFile")}
        description={t("settingsPanel.about.settingsFileDescription")}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Code className="flex-1 min-w-0 truncate">{env?.settingsPath ?? "—"}</Code>
          <Button
            size="md"
            disabled={!env}
            onClick={() => env && actions.reveal(env.settingsPath)}
            icon={<FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {t("settingsPanel.revealInFinder")}
          </Button>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
