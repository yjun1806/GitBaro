import { AVATAR_HUES, avatarColor, avatarColorFromHue, type AvatarColor } from "@/lib/avatar-color";

/** 저장소별 알림 설정. 없으면 앱 설정을 따른다. */
export type NotifyOverride = "on" | "off";

export type RepoNotifyKind = "newCommits" | "ciFailures";

/**
 * 저장소 하나에만 적용하는 앱 안 설정. 폴더·원격·GitHub에는 아무것도 쓰지 않는다.
 * 모든 필드는 선택이고, 없으면 기본 동작을 쓴다.
 */
export interface RepoPrefs {
  /** 표시 이름. 비어 있으면 폴더 이름을 쓴다. */
  alias?: string;
  /** 아바타 색상(hue, `AVATAR_HUES` 중 하나). 없으면 경로에서 정한 색. */
  hue?: number;
  /** 알림 종류별 설정. 항목이 없으면 앱 설정을 따른다. */
  notify?: Partial<Record<RepoNotifyKind, NotifyOverride>>;
}

export const ALIAS_MAX_LENGTH = 60;

const NOTIFY_KINDS: readonly RepoNotifyKind[] = ["newCommits", "ciFailures"];

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 값 하나를 정리한다. 쓸 게 하나도 없으면 null. 모르는 필드(예: 없앤 비교 기준 설정 `compareBase`)는
 * 오류 없이 버린다.
 */
export function normalizeRepoPrefs(value: unknown): RepoPrefs | null {
  if (!isPlainRecord(value)) return null;
  const out: RepoPrefs = {};
  if (typeof value.alias === "string") {
    const alias = value.alias.trim().slice(0, ALIAS_MAX_LENGTH);
    if (alias) out.alias = alias;
  }
  if (typeof value.hue === "number" && AVATAR_HUES.includes(value.hue)) out.hue = value.hue;
  if (isPlainRecord(value.notify)) {
    const src = value.notify;
    const notify: Partial<Record<RepoNotifyKind, NotifyOverride>> = {};
    for (const kind of NOTIFY_KINDS) {
      if (src[kind] === "on" || src[kind] === "off") notify[kind] = src[kind];
    }
    if (Object.keys(notify).length > 0) out.notify = notify;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 저장값 전체를 정리한다. 깨진 항목은 빼고, 비어 있는 항목도 뺀다. */
export function sanitizeRepoPrefsMap(value: unknown): Record<string, RepoPrefs> {
  if (!isPlainRecord(value)) return {};
  const out: Record<string, RepoPrefs> = {};
  for (const [path, prefs] of Object.entries(value)) {
    const clean = normalizeRepoPrefs(prefs);
    if (clean) out[path] = clean;
  }
  return out;
}

/**
 * 저장소 하나의 설정에 바꿀 값을 합친다. `undefined`인 필드는 지운다(기본값으로 돌린다).
 * 결과가 비면 항목을 없앤다. 입력은 바꾸지 않는다.
 */
export function withRepoPrefs(
  map: Readonly<Record<string, RepoPrefs>>,
  path: string,
  patch: Partial<RepoPrefs>,
): Record<string, RepoPrefs> {
  const merged: Record<string, unknown> = { ...map[path] };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const clean = normalizeRepoPrefs(merged);
  const { [path]: _removed, ...rest } = map;
  return clean ? { ...rest, [path]: clean } : rest;
}

/** 화면에 보일 저장소 이름: 표시 이름이 있으면 그것, 없으면 폴더 이름. */
export function repoDisplayName(
  repo: { path: string; name: string },
  prefs: Readonly<Record<string, RepoPrefs>>,
): string {
  return prefs[repo.path]?.alias ?? repo.name;
}

/** 저장소 아바타 색: 고른 색이 있으면 그것, 없으면 경로에서 정한 색. */
export function repoAvatarColor(path: string, prefs: Readonly<Record<string, RepoPrefs>>): AvatarColor {
  const hue = prefs[path]?.hue;
  return hue === undefined ? avatarColor(path) : avatarColorFromHue(hue);
}
