import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Info, List, RefreshCw, Tag, Trash2, UserRound } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoSettingsStore, type RepoSettingsSection } from "@/stores/repo-settings";
import { useRepoAvatarColor, useRepoName } from "@/hooks/useRepoDisplay";
import type { RepoInfo } from "@/types";
import { SettingsShell } from "../ui/SettingsShell";
import type { SettingsNavItem } from "../ui/SettingsNav";
import { RepoAvatarBadge } from "./RepoAvatarBadge";
import { NameSection } from "./NameSection";
import { AccountSection } from "./AccountSection";
import { SyncSection } from "./SyncSection";
import { ListSection } from "./ListSection";
import { NotifySection } from "./NotifySection";
import { InfoSection } from "./InfoSection";
import { DangerSection } from "./DangerSection";

interface RepoSettingsDialogProps {
  repo: RepoInfo;
  initialSection?: RepoSettingsSection;
  onClose: () => void;
}

/**
 * 저장소 하나의 설정 창. 앱 설정 창과 같은 틀(`SettingsShell`)을 쓴다.
 * 여기서 바꾸는 값은 모두 GitBaro 안에만 저장한다. 폴더·원격·GitHub에는 쓰지 않는다.
 */
export function RepoSettingsDialog({ repo, initialSection = "name", onClose }: RepoSettingsDialogProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<RepoSettingsSection>(initialSection);
  const name = useRepoName()(repo);
  const color = useRepoAvatarColor()(repo.path);

  const items: SettingsNavItem<RepoSettingsSection>[] = [
    { id: "name", label: t("repoSettings.nav.name"), icon: Tag },
    { id: "account", label: t("repoSettings.nav.account"), icon: UserRound },
    { id: "sync", label: t("repoSettings.nav.sync"), icon: RefreshCw },
    { id: "list", label: t("repoSettings.nav.list"), icon: List },
    { id: "notifications", label: t("repoSettings.nav.notifications"), icon: Bell },
    { id: "info", label: t("repoSettings.nav.info"), icon: Info },
    { id: "danger", label: t("repoSettings.nav.danger"), icon: Trash2, danger: true },
  ];

  return (
    <SettingsShell
      title={name}
      subtitle={name === repo.name ? t("repoSettings.subtitle") : repo.name}
      leading={<RepoAvatarBadge name={name} color={color} className="w-8 h-8 text-[14px]" />}
      items={items}
      active={active}
      onSelect={setActive}
      onClose={onClose}
    >
      {active === "name" && <NameSection repo={repo} />}
      {active === "account" && <AccountSection repo={repo} />}
      {active === "sync" && <SyncSection repo={repo} />}
      {active === "list" && <ListSection repo={repo} />}
      {active === "notifications" && <NotifySection repo={repo} />}
      {active === "info" && <InfoSection repo={repo} />}
      {active === "danger" && <DangerSection repo={repo} onRemoved={onClose} />}
    </SettingsShell>
  );
}

/** 어디서 열었든(머리 줄, 저장소 메뉴, 자동 최신화 안내) 저장소 설정 창을 한 곳에서 띄운다. */
export function RepoSettingsHost() {
  const repoPath = useRepoSettingsStore((s) => s.repoPath);
  const section = useRepoSettingsStore((s) => s.section);
  const close = useRepoSettingsStore((s) => s.close);
  const repo = useRepositoryStore((s) => s.repos.find((r) => r.path === repoPath) ?? null);
  if (!repo) return null;
  return <RepoSettingsDialog key={`${repo.path}\u0000${section}`} repo={repo} initialSection={section} onClose={close} />;
}
