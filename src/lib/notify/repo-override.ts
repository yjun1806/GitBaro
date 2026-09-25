import type { NotificationSettings } from "@/types";
import type { NotifyOverride, RepoNotifyKind, RepoPrefs } from "@/lib/repo-prefs";

/** 저장소 설정 화면의 세 가지 선택: 켬 / 앱 설정 따름 / 끔. */
export type NotifyChoice = NotifyOverride | "inherit";

/** 저장소 하나에서 이 종류의 알림을 보낼지. 저장소 설정이 있으면 그것, 없으면 앱 설정. */
export function isRepoNotifyOn(
  settings: Pick<NotificationSettings, RepoNotifyKind>,
  prefs: Readonly<Record<string, RepoPrefs>>,
  repoPath: string,
  kind: RepoNotifyKind,
): boolean {
  const override = prefs[repoPath]?.notify?.[kind];
  if (override === "on") return true;
  if (override === "off") return false;
  return settings[kind];
}

/**
 * 이 종류의 알림을 살펴볼 저장소가 하나라도 있는지. 앱 설정을 꺼도 켠 저장소가 있으면
 * 감시(워크트리 목록·Actions 조회)는 돌아야 한다.
 */
export function isNotifyNeeded(
  settings: Pick<NotificationSettings, RepoNotifyKind>,
  prefs: Readonly<Record<string, RepoPrefs>>,
  repoPaths: readonly string[],
  kind: RepoNotifyKind,
): boolean {
  return repoPaths.some((path) => isRepoNotifyOn(settings, prefs, path, kind));
}

/** 저장소 설정 화면에 보일 지금 선택. */
export function repoNotifyChoice(
  prefs: Readonly<Record<string, RepoPrefs>>,
  repoPath: string,
  kind: RepoNotifyKind,
): NotifyChoice {
  return prefs[repoPath]?.notify?.[kind] ?? "inherit";
}

/** 선택을 저장 형식으로 바꾼다. 「앱 설정 따름」이면 항목을 뺀다. */
export function withNotifyChoice(
  current: RepoPrefs["notify"],
  kind: RepoNotifyKind,
  choice: NotifyChoice,
): RepoPrefs["notify"] {
  const { [kind]: _removed, ...rest } = current ?? {};
  const next = choice === "inherit" ? rest : { ...rest, [kind]: choice };
  return Object.keys(next).length > 0 ? next : undefined;
}
