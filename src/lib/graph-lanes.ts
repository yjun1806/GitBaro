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
  /** laneKey → 고정 레인 */
  readonly pinned: Readonly<Record<string, number>>;
  readonly nextChain: number;
}

export interface GraphLaneResult {
  readonly rows: readonly GraphRowLayout[];
  readonly state: GraphLaneState;
}

export interface CreateLaneStateOptions {
  /** 미리 레인을 예약할 키. 순서대로 레인 0, 1, 2…를 받는다. */
  readonly pinnedKeys?: readonly string[];
}

export function createGraphLaneState(options: CreateLaneStateOptions = {}): GraphLaneState {
  const pinned: Record<string, number> = {};
  let next = 0;
  for (const key of options.pinnedKeys ?? []) {
    if (!(key in pinned)) pinned[key] = next++;
  }
  return { lanes: [], pinned, nextChain: 0 };
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
  const pinned: Record<string, number> = { ...prev.pinned };
  const reserved = new Set<number>(Object.values(pinned));
  // oid → 그 커밋을 기다리는 레인들. 레인 배열을 매번 훑지 않으려는 색인이다.
  const waiting = new Map<string, number[]>();
  lanes.forEach((slot, index) => {
    if (slot) addWaiting(waiting, slot.oid, index);
  });
  let nextChain = prev.nextChain;

  const freeLane = (): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null && !reserved.has(i)) return i;
    }
    let i = lanes.length;
    while (reserved.has(i)) i++;
    return i;
  };

  const setLane = (index: number, slot: LaneSlot | null) => {
    while (lanes.length <= index) lanes.push(null);
    const old = lanes[index];
    if (old) removeWaiting(waiting, old.oid, index);
    lanes[index] = slot;
    if (slot) addWaiting(waiting, slot.oid, index);
  };

  const rows: GraphRowLayout[] = [];

  for (const commit of commits) {
    const topLanes = lanes.slice();
    const expecting = [...(waiting.get(commit.oid) ?? [])].sort((a, b) => a - b);
    const key = commit.laneKey;
    const pinnedLane = key !== undefined ? pinned[key] : undefined;

    let lane: number;
    let chain: number;
    if (expecting.length > 0) {
      lane =
        pinnedLane !== undefined && expecting.includes(pinnedLane) ? pinnedLane : expecting[0];
      chain = (topLanes[lane] as LaneSlot).chain;
    } else {
      if (pinnedLane !== undefined && !lanes[pinnedLane]) {
        lane = pinnedLane;
      } else {
        lane = freeLane();
        if (key !== undefined && pinnedLane === undefined) {
          pinned[key] = lane;
          reserved.add(lane);
        }
      }
      chain = nextChain++;
    }

    const edges: GraphEdge[] = [];
    // 이 커밋을 기다리던 레인은 모두 커밋 점으로 모이고, 비워진다.
    for (const index of expecting) {
      edges.push({ kind: "in", fromLane: index, toLane: lane, chain: (topLanes[index] as LaneSlot).chain });
      setLane(index, null);
    }

    const parents = unique(commit.parentIds);
    parents.forEach((parent, i) => {
      const existing = waiting.get(parent);
      if (existing && existing.length > 0) {
        // 다른 줄기가 이미 이 부모를 기다린다 → 그 레인으로 합류한다.
        const target = Math.min(...existing);
        const edgeChain = i === 0 ? chain : (lanes[target] as LaneSlot).chain;
        edges.push({ kind: "out", fromLane: lane, toLane: target, chain: edgeChain });
        return;
      }
      if (i === 0) {
        setLane(lane, { oid: parent, chain });
        edges.push({ kind: "out", fromLane: lane, toLane: lane, chain });
        return;
      }
      const target = freeLane();
      const newChain = nextChain++;
      setLane(target, { oid: parent, chain: newChain });
      edges.push({ kind: "out", fromLane: lane, toLane: target, chain: newChain });
    });

    topLanes.forEach((slot, index) => {
      if (slot && slot.oid !== commit.oid) {
        edges.push({ kind: "pass", fromLane: index, toLane: index, chain: slot.chain });
      }
    });

    trimTrailingNulls(lanes);
    rows.push({ oid: commit.oid, lane, chain, edges, width: rowWidth(lane, edges) });
  }

  return { rows, state: { lanes, pinned, nextChain } };
}

function addWaiting(waiting: Map<string, number[]>, oid: string, index: number) {
  const list = waiting.get(oid);
  if (list) list.push(index);
  else waiting.set(oid, [index]);
}

function removeWaiting(waiting: Map<string, number[]>, oid: string, index: number) {
  const list = waiting.get(oid);
  if (!list) return;
  const rest = list.filter((i) => i !== index);
  if (rest.length > 0) waiting.set(oid, rest);
  else waiting.delete(oid);
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
