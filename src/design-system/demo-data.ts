/**
 * 디자인 시스템 번들의 패턴 카드(GraphRow, SidebarRowSignals, FileTouchesRow)가 쓰는 목 데이터.
 * 실제 백엔드 응답 모양(types/index.ts)을 그대로 따르되 값은 지어낸 것이다 — 실제 저장소·커밋·
 * 이메일은 담지 않는다.
 */
import type { BranchInfo, CommitInfo, CommitTouch, FileTouches, RefLabel } from "@/types";
import type { RowSignalValues } from "@/components/sidebar/RowSignals";
import type { FileTouchRow, FileTouchSource, GroupedFileTouches } from "@/components/review/file-touches-model";

const DEMO_EMAIL = "dev@gitbaro.app";

function ref(name: string, kind: RefLabel["kind"], isHead = false): RefLabel {
  return { name, kind, isHead };
}

/** GraphRow 카드: 브랜치 하나가 base에서 갈라져 나왔다가 다시 합쳐지는 6개 커밋. */
export const DEMO_COMMITS: CommitInfo[] = [
  {
    id: "c1",
    shortId: "96f8997",
    message: "feat(sidebar): show uncommitted at a glance",
    summary: "feat(sidebar): show uncommitted at a glance",
    author: { name: "YJun", email: DEMO_EMAIL },
    committer: { name: "YJun", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 3600,
    parentIds: ["c2"],
    refs: [ref("feat/agent-review-ux", "localBranch", true)],
    isUnpushed: true,
    coAuthors: [],
    isAgentAuthored: false,
  },
  {
    id: "c2",
    shortId: "7d4a1e2",
    message: "merge: main",
    summary: "merge: main",
    author: { name: "YJun", email: DEMO_EMAIL },
    committer: { name: "YJun", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 5400,
    parentIds: ["c3", "c6"],
    refs: [],
    isUnpushed: true,
    coAuthors: [],
    isAgentAuthored: false,
  },
  {
    id: "c3",
    shortId: "1a2b3c4",
    message: "fix(graph): keep chain highlight after selection",
    summary: "fix(graph): keep chain highlight after selection",
    author: { name: "Claude", email: DEMO_EMAIL },
    committer: { name: "Claude", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 7200,
    parentIds: ["c4"],
    refs: [],
    isUnpushed: true,
    coAuthors: [{ name: "Claude", email: "noreply@anthropic.com" }],
    isAgentAuthored: true,
  },
  {
    id: "c6",
    shortId: "5e6f7a8",
    message: "chore: bump lockfile",
    summary: "chore: bump lockfile",
    author: { name: "YJun", email: DEMO_EMAIL },
    committer: { name: "YJun", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 9000,
    parentIds: ["c4"],
    refs: [],
    isUnpushed: true,
    coAuthors: [],
    isAgentAuthored: false,
  },
  {
    id: "c4",
    shortId: "92936ac",
    message: "docs(design): add design system guide",
    summary: "docs(design): add design system guide",
    author: { name: "YJun", email: DEMO_EMAIL },
    committer: { name: "YJun", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 10800,
    parentIds: ["c5"],
    refs: [ref("main", "localBranch"), ref("origin/main", "remoteBranch")],
    isUnpushed: false,
    coAuthors: [],
    isAgentAuthored: false,
  },
  {
    id: "c5",
    shortId: "3f2e1d0",
    message: "chore: initial commit",
    summary: "chore: initial commit",
    author: { name: "YJun", email: DEMO_EMAIL },
    committer: { name: "YJun", email: DEMO_EMAIL },
    timestamp: Date.now() / 1000 - 14400,
    parentIds: [],
    refs: [],
    isUnpushed: false,
    coAuthors: [],
    isAgentAuthored: false,
  },
];

/** SidebarRowSignals 카드: 저장소별로 다른 조합(커밋 안 함만 / 받을·올릴 만 / 지금 바뀌는 중). */
export const DEMO_ROW_SIGNALS: { repo: string; values: RowSignalValues }[] = [
  { repo: "gitbaro", values: { dirty: 3, live: true, watched: true, changedAt: Date.now() - 8000, ahead: 1, behind: 2 } },
  { repo: "baro-web", values: { dirty: 0, live: false, watched: true, changedAt: 0, ahead: 4, behind: 0 } },
  { repo: "infra-scripts", values: { dirty: 5, live: true, watched: false, changedAt: Date.now() - 20000, ahead: 0, behind: 0 } },
];

function touch(oid: string, subject: string, path: string, minutesAgo: number, additions = 5, deletions = 1): CommitTouch {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    subject,
    authorTime: Math.floor(Date.now() / 1000 - minutesAgo * 60),
    parentOid: null,
    path,
    oldPath: null,
    status: "modified",
    additions,
    deletions,
    isBinary: false,
    tooLarge: false,
  };
}

function fileTouches(path: string, additions: number, deletions: number, commits: CommitTouch[]): FileTouches {
  return { path, oldPath: null, status: "modified", additions, deletions, isBinary: false, tooLarge: false, commits };
}

const SOURCE: FileTouchSource = { repoPath: "/repos/gitbaro", path: "/repos/gitbaro", worktreeLabel: null };

const multiRow: FileTouchRow = {
  key: "graphrow",
  source: SOURCE,
  touches: fileTouches("src/components/graph/GraphRow.tsx", 42, 11, [
    touch("a1", "fix(graph): keep chain highlight after selection", "src/components/graph/GraphRow.tsx", 30),
    touch("a2", "feat(graph): add chain highlight", "src/components/graph/GraphRow.tsx", 180),
    touch("a3", "refactor(graph): split GraphCell", "src/components/graph/GraphRow.tsx", 400),
  ]),
  rangeBase: "base",
  head: "head",
};

const singleRow: FileTouchRow = {
  key: "focusflash",
  source: SOURCE,
  touches: fileTouches("src/components/ui/FocusFlash.tsx", 18, 0, [
    touch("b1", "feat(ui): add FocusFlash GB-241", "src/components/ui/FocusFlash.tsx", 1440),
  ]),
  rangeBase: "base",
  head: "head",
};

const mergeOnlyRow: FileTouchRow = {
  key: "conflict",
  source: SOURCE,
  touches: fileTouches("src/components/graph/graph-paint.ts", 6, 2, []),
  rangeBase: "base",
  head: "head",
};

/** BranchCombobox 카드: 지금 켜진 브랜치 · 기본 브랜치 · 아직 push한 적 없는 브랜치. */
export const DEMO_BRANCHES: BranchInfo[] = [
  {
    name: "feat/agent-review-ux",
    isHead: true,
    isRemote: false,
    isDefault: false,
    upstream: "origin/feat/agent-review-ux",
    aheadBehind: { ahead: 2, behind: 0 },
    lastCommitTime: Date.now() / 1000 - 3600,
    isFullyMerged: false,
    lastCommitAuthor: { name: "YJun", email: DEMO_EMAIL },
  },
  {
    name: "main",
    isHead: false,
    isRemote: false,
    isDefault: true,
    upstream: "origin/main",
    aheadBehind: { ahead: 0, behind: 3 },
    lastCommitTime: Date.now() / 1000 - 86400,
    isFullyMerged: true,
    lastCommitAuthor: { name: "YJun", email: DEMO_EMAIL },
  },
  {
    name: "fix/graph-redesign",
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: Date.now() / 1000 - 172800,
    isFullyMerged: false,
    lastCommitAuthor: { name: "Claude", email: DEMO_EMAIL },
  },
];

/** FileTouchesList(「파일별 보기」) 카드: 커밋 여러 개 / 하나 / 병합에서만 바뀐 파일 한 줄씩. */
export const DEMO_GROUPED_FILE_TOUCHES: GroupedFileTouches = {
  multi: [multiRow],
  single: [singleRow],
  mergeOnly: [mergeOnlyRow],
  pending: [],
  errors: [],
  truncated: [],
  merges: [],
};
