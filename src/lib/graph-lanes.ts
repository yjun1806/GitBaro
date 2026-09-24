/**
 * 커밋 그래프 레인 계산.
 *
 * 부모 SHA만으로 각 커밋이 몇 번째 레인(세로줄)에 놓이는지, 그리고 그 행에
 * 그릴 선이 무엇인지 계산하는 순수 함수다. 렌더링·색 결정은 하지 않는다.
 *
 * - 입력은 화면 순서(최신 → 과거, 부모가 자식보다 뒤)의 `{oid, parentIds}` 배열이다.
 * - 행마다 선을 "위 가장자리 → 아래 가장자리" 기준으로 완결되게 돌려주므로,
 *   가상 스크롤로 한 행만 그려도 이웃 행을 볼 필요가 없다.
 * - 다음 페이지는 이전 호출이 돌려준 `state`를 넘겨 이어서 계산한다.
 *   이미 돌려준 행과 넘겨받은 상태는 절대 바꾸지 않으므로 앞 페이지의 레인은 그대로다.
 * - `laneKey`(저장소·워크트리 경로 등)를 주면 그 키의 커밋이 새 줄기를 시작할 때
 *   항상 같은 레인을 쓴다. 여러 저장소를 한 그래프에 섞을 때 저장소별 레인을 고정한다.
 *
 * 입력이 어긋날 때의 처리:
 * - 이미 그린 커밋이 다시 오면(오프셋 페이징 중 새 커밋이 생겨 페이지가 밀린 경우 등)
 *   행을 만들지 않고 `duplicateOids`로 알려 준다.
 * - 부모가 자식보다 먼저 와 이미 그려졌다면(커밋 시각이 뒤틀린 시간순 정렬 등)
 *   그 부모로 가는 선은 그리지 않는다. 기다릴 대상이 없는 레인이 영원히 열려 있지 않게 하려는 것이다.
 * - 빠진 커밋(페이지가 밀려 건너뛴 커밋)은 이 함수가 알아챌 수 없다. 그 커밋을 기다리는 레인은
 *   계속 지나가는 선으로 남으므로, 호출자는 커서(마지막 oid) 기준으로 페이징하거나 이력이 바뀌면
 *   처음부터 다시 계산해야 한다.
 * - 목록에 끝내 나오지 않을 부모(병합 기준점 아래에서 이력을 끊은 경우 등)도 레인을 연 채로 남긴다.
 *   이력을 중간에서 끊는 호출자는 그 부모들을 `parentIds`에서 빼고 넘긴다.
 */

export interface GraphCommitInput {
  readonly oid: string;
  readonly parentIds: readonly string[];
  /** 레인을 고정할 키. 같은 키의 새 줄기는 처음 배정된 레인을 다시 쓴다. */
  readonly laneKey?: string;
}

/**
 * 한 행 안의 선 하나.
 * - `pass`: 커밋과 무관하게 지나가는 선. 위 가장자리 `fromLane` → 아래 가장자리 `toLane`.
 * - `in`: 위 가장자리 `fromLane` → 이 행의 커밋 점.
 * - `out`: 이 행의 커밋 점 → 아래 가장자리 `toLane`(부모가 기다리는 레인).
 */
export type GraphEdgeKind = "pass" | "in" | "out";

export interface GraphEdge {
  readonly kind: GraphEdgeKind;
  readonly fromLane: number;
  readonly toLane: number;
  /** 선이 속한 줄기 번호. 색을 고를 때 쓴다(레인 번호와 달리 줄기마다 고유). */
  readonly chain: number;
}

export interface GraphRowLayout {
  readonly oid: string;
  /** 커밋 점이 놓이는 레인(0부터). */
  readonly lane: number;
  /** 커밋 점이 속한 줄기 번호. */
  readonly chain: number;
  readonly edges: readonly GraphEdge[];
  /** 이 행이 쓰는 레인 수(가장 오른쪽 레인 + 1). */
  readonly width: number;
}


interface LaneSlot {
  /** 이 레인이 다음에 만나기를 기다리는 커밋 */
  readonly oid: string;
  readonly chain: number;
}

/** 페이지 사이에 이어받는 계산 상태. 불변으로 다룬다. */
export interface GraphLaneState {
  readonly lanes: readonly (LaneSlot | null)[];
  /** laneKey → 고정 레인. 키가 어떤 문자열이든 안전하도록 Map을 쓴다. */
  readonly pinned: ReadonlyMap<string, number>;
  /** 이미 행을 만든 커밋. 중복 커밋과 순서가 뒤집힌 부모를 걸러 낸다. */
  readonly seen: ReadonlySet<string>;
  readonly nextChain: number;
}

export interface GraphLaneResult {
  /** 새로 그린 커밋마다 한 행. 이미 그린 커밋은 빠진다. */
  readonly rows: readonly GraphRowLayout[];
  readonly state: GraphLaneState;
  /**
   * 이미 그린 커밋이라 행을 만들지 않은 oid. 비어 있지 않으면 페이지가 밀렸다는 신호이니,
   * 호출자는 목록에서도 같은 커밋을 빼거나 처음부터 다시 계산한다.
   */
  readonly duplicateOids: readonly string[];
}

export interface CreateLaneStateOptions {
  /** 미리 레인을 예약할 키. 순서대로 레인 0, 1, 2…를 받는다. */
  readonly pinnedKeys?: readonly string[];
}

export function createGraphLaneState(options: CreateLaneStateOptions = {}): GraphLaneState {
  const pinned = new Map<string, number>();
  for (const key of options.pinnedKeys ?? []) {
    if (!pinned.has(key)) pinned.set(key, pinned.size);
  }
  return { lanes: [], pinned, seen: new Set(), nextChain: 0 };
}

/**
 * `commits`의 레인을 계산한다. `prev`를 주면 그 상태에서 이어서 계산한다.
 * `prev`는 바꾸지 않고, 새 상태를 `state`로 돌려준다.
 */
export function computeGraphLanes(
  commits: readonly GraphCommitInput[],
  prev: GraphLaneState = createGraphLaneState(),
): GraphLaneResult {
  // 성능을 위해 이 호출 안에서만 쓰는 복사본을 고친다. `prev`는 건드리지 않는다.
  const lanes: (LaneSlot | null)[] = [...prev.lanes];
  const pinned = new Map(prev.pinned);
  const seen = new Set(prev.seen);
  // 고정 레인 → 그 레인의 주인 키
  const owners = new Map<number, string>();
  pinned.forEach((lane, key) => owners.set(lane, key));
  // oid → 그 커밋을 기다리는 레인. 부모를 이미 기다리는 레인이 있으면 새 레인을 열지 않고
  // 그 레인으로 합류하므로, 한 커밋을 기다리는 레인은 언제나 하나뿐이다.
  const waiting = new Map<string, number>();
  lanes.forEach((slot, index) => {
    if (slot) waiting.set(slot.oid, index);
  });
  let nextChain = prev.nextChain;

  const freeLane = (): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null && !owners.has(i)) return i;
    }
    let i = lanes.length;
    while (owners.has(i)) i++;
    return i;
  };

  const setLane = (index: number, slot: LaneSlot | null) => {
    while (lanes.length <= index) lanes.push(null);
    const old = lanes[index];
    if (old) waiting.delete(old.oid);
    lanes[index] = slot;
    if (slot) waiting.set(slot.oid, index);
  };

  const rows: GraphRowLayout[] = [];
  const duplicateOids: string[] = [];

  for (const commit of commits) {
    if (seen.has(commit.oid)) {
      duplicateOids.push(commit.oid);
      continue;
    }
    seen.add(commit.oid);

    const topLanes = lanes.slice();
    const expected = waiting.get(commit.oid);
    const key = commit.laneKey;
    const pinnedLane = key !== undefined ? pinned.get(key) : undefined;

    let lane: number;
    let chain: number;
    if (expected !== undefined) {
      lane = expected;
      chain = (topLanes[lane] as LaneSlot).chain;
    } else {
      if (pinnedLane !== undefined && !lanes[pinnedLane]) {
        lane = pinnedLane;
      } else {
        lane = freeLane();
        if (key !== undefined && pinnedLane === undefined) {
          pinned.set(key, lane);
          owners.set(lane, key);
        }
      }
      chain = nextChain++;
    }

    const edges: GraphEdge[] = [];
    if (expected !== undefined) {
      // 이 커밋을 기다리던 레인은 커밋 점으로 이어지고, 비워진다.
      edges.push({ kind: "in", fromLane: lane, toLane: lane, chain });
      setLane(lane, null);
    }

    // 남의 고정 레인에서 이어진 줄기는 첫 부모부터 그 레인을 비켜 준다.
    // 그래야 그 키의 다음 새 줄기가 제 레인을 쓸 수 있다.
    const owner = owners.get(lane);
    const firstParentLane = owner !== undefined && owner !== key ? freeLane() : lane;

    const parents = unique(commit.parentIds).filter((parent) => !seen.has(parent));
    parents.forEach((parent, i) => {
      const existing = waiting.get(parent);
      if (existing !== undefined) {
        // 다른 줄기가 이미 이 부모를 기다린다 → 그 레인으로 합류한다.
        const edgeChain = i === 0 ? chain : (lanes[existing] as LaneSlot).chain;
        edges.push({ kind: "out", fromLane: lane, toLane: existing, chain: edgeChain });
        return;
      }
      const target = i === 0 ? firstParentLane : freeLane();
      const parentChain = i === 0 ? chain : nextChain++;
      setLane(target, { oid: parent, chain: parentChain });
      edges.push({ kind: "out", fromLane: lane, toLane: target, chain: parentChain });
    });

    topLanes.forEach((slot, index) => {
      if (slot && slot.oid !== commit.oid) {
        edges.push({ kind: "pass", fromLane: index, toLane: index, chain: slot.chain });
      }
    });

    trimTrailingNulls(lanes);
    rows.push({ oid: commit.oid, lane, chain, edges, width: rowWidth(lane, edges) });
  }

  return { rows, state: { lanes, pinned, seen, nextChain }, duplicateOids };
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function trimTrailingNulls(lanes: (LaneSlot | null)[]) {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
}

function rowWidth(lane: number, edges: readonly GraphEdge[]): number {
  let max = lane;
  for (const edge of edges) {
    if (edge.fromLane > max) max = edge.fromLane;
    if (edge.toLane > max) max = edge.toLane;
  }
  return max + 1;
}
