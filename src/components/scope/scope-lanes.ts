import { isHiddenReviewRepo, type ReviewRepoSignals } from "@/components/review/review-model";
import { laneColor } from "@/components/graph/graph-model";
import type { Scope } from "./scope";

/**
 * 범위 하나의 레인 하나: 체크아웃된 워크트리, 또는 사이드바 「작업 중인 브랜치」 줄 중
 * 어느 워크트리에도 체크아웃되지 않은 브랜치.
 */
export interface LaneSource extends ReviewRepoSignals {
  /** 레인 식별자. 체크아웃됐으면 워크트리 경로, 아니면 {@link branchLaneId}. */
  id: string;
  repoPath: string;
  /** 체크아웃된 워크트리 경로. 체크아웃하지 않은 브랜치 레인이면 null. */
  worktreePath: string | null;
  /** 저장소의 메인 작업 트리인 레인인지(레인 색·늘 켜진 레인 판단에 쓴다). */
  isMain: boolean;
  /** 이 레인이 커밋을 올리는 원격 이름(영역 머리의 원격 이름 규칙에 쓴다). */
  remotes: readonly string[];
  /** 레인의 선·칩 색(`hsl(...)`). {@link laneColorsFor}가 매긴다. */
  color: string;
}

/** 체크아웃하지 않은 브랜치 레인의 id. `\u0000`은 경로에 나올 수 없어 저장소 경로와 안전하게 나뉜다. */
export function branchLaneId(repoPath: string, branch: string): string {
  return `${repoPath}\u0000${branch}`;
}

/**
 * 조용한 레인인지: 기본 브랜치에 있고, 원격에 없는 커밋도 커밋하지 않은 변경도 없다. 저장소
 * 리뷰 화면이 저장소 하나를 숨길 때 쓰는 규칙(`isHiddenReviewRepo`)을 레인 하나에 그대로
 * 적용한다 — 워크스페이스의 저장소 칩과 저장소의 워크트리 칩이 같은 규칙을 쓴다.
 */
export function isQuietLane(source: ReviewRepoSignals): boolean {
  return isHiddenReviewRepo(source);
}

/** 워크스페이스 단계의 저장소 칩 기본 on/off: 그 저장소의 레인 중 하나라도 조용하지 않으면 켠다. */
export function isRepoActive(sources: readonly LaneSource[], repoPath: string): boolean {
  return sources.some((s) => s.repoPath === repoPath && !isQuietLane(s));
}

/**
 * 늘 켜져 있어 끌 수 없는 레인의 id.
 * - 브랜치 단계: 그 레인 자신(레인이 하나뿐이다).
 * - 저장소 단계: 기본 워크트리(메인 작업 트리, 없으면 첫 레인).
 * - 워크스페이스 단계: 없음(저장소 칩으로 저장소째 끌 수 있다).
 */
export function pinnedLaneId(scope: Scope, sources: readonly LaneSource[]): string | null {
  if (scope.kind === "branch") return sources[0]?.id ?? null;
  if (scope.kind === "repo") return (sources.find((s) => s.isMain) ?? sources[0])?.id ?? null;
  return null;
}

/** 사용자가 칩을 건드리지 않았을 때 레인 하나가 기본으로 보이는지. */
export function isLaneShownByDefault(scope: Scope, source: LaneSource): boolean {
  if (scope.kind === "workspace") return !isQuietLane(source) || source.isMain;
  return !isQuietLane(source);
}

/**
 * 지금 보일 레인 목록(입력 순서를 지킨다). `repoShown`은 워크스페이스 단계의 저장소 칩,
 * `laneShown`은 레인 칩(저장소 단계의 워크트리 칩) 오버라이드다. 둘 다 사용자가 건드린 것만
 * 담고, 건드리지 않았으면 기본값(`isRepoActive`·`isLaneShownByDefault`)을 쓴다.
 */
export function visibleLaneSources(
  scope: Scope,
  sources: readonly LaneSource[],
  repoShown: ReadonlyMap<string, boolean>,
  laneShown: ReadonlyMap<string, boolean>,
): LaneSource[] {
  const pinned = pinnedLaneId(scope, sources);
  return sources.filter((s) => {
    if (s.id === pinned) return true;
    if (scope.kind === "workspace") {
      const repoOn = repoShown.get(s.repoPath) ?? isRepoActive(sources, s.repoPath);
      if (!repoOn) return false;
    }
    return laneShown.get(s.id) ?? isLaneShownByDefault(scope, s);
  });
}

/** 쓰기(스테이징·커밋·reset)가 되는 레인의 id: 체크아웃한 브랜치 단계일 때만, 그 레인. 아니면 null. */
export function openedLaneId(scope: Scope, sources: readonly LaneSource[]): string | null {
  if (scope.kind !== "branch") return null;
  const lane = sources[0];
  return lane && lane.worktreePath !== null ? lane.id : null;
}

/**
 * 영역 머리에 쓸 원격 이름. 레인 모두가 원격을 하나씩만 쓰고 그 이름이 같으면 그 이름,
 * 아니면 null(「원격에 있음」으로 표시).
 */
export function sharedRemoteName(lanes: readonly { remotes: readonly string[] }[]): string | null {
  if (lanes.length === 0) return null;
  let name: string | null = null;
  for (const lane of lanes) {
    if (lane.remotes.length !== 1) return null;
    if (name === null) name = lane.remotes[0];
    else if (name !== lane.remotes[0]) return null;
  }
  return name;
}

/**
 * 레인마다 색을 매긴다(입력 순서를 지킨다).
 * - 워크스페이스 단계: 저장소 색조 그대로에 그 저장소 안 레인 순서로 명도만 바꾼다(같은 저장소는
 *   한눈에 같은 색으로 보인다). 그래프의 `laneColor(seed, chain)`과 같은 규칙이다.
 * - 저장소·브랜치 단계: 레인(워크트리)마다 저마다 다른 색조를 쓴다(`laneColor(id, 0)`).
 */
export function laneColorsFor(
  scope: Scope,
  sources: readonly Pick<LaneSource, "id" | "repoPath">[],
): Map<string, string> {
  const colors = new Map<string, string>();
  if (scope.kind === "workspace") {
    const chainByRepo = new Map<string, number>();
    for (const s of sources) {
      const chain = chainByRepo.get(s.repoPath) ?? 0;
      chainByRepo.set(s.repoPath, chain + 1);
      colors.set(s.id, laneColor(s.repoPath, chain));
    }
  } else {
    for (const s of sources) colors.set(s.id, laneColor(s.id, 0));
  }
  return colors;
}
