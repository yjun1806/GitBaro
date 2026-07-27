import { describe, expect, it } from "vitest";
import {
  UNLINKED_GROUP_KEY,
  groupCommitsBySession,
} from "@/components/history/session-groups";
import type {
  CommitInfo,
  LinkConfidence,
  SessionCommitLink,
  SessionSummary,
} from "@/types";

function makeCommit(id: string): CommitInfo {
  return {
    id,
    shortId: id.slice(0, 7),
    message: `${id} message`,
    summary: `${id} summary`,
    author: { name: "Author", email: "author@example.com" },
    committer: { name: "Author", email: "author@example.com" },
    timestamp: 1_700_000_000,
    parentIds: [],
    refs: [],
  };
}

function makeSession(
  sessionId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    sessionId,
    source: "claudeCode",
    filePath: `/logs/${sessionId}.jsonl`,
    cwd: "/repo",
    gitBranch: "main",
    startedAt: 1_000_000,
    endedAt: 1_000_000 + 47 * 60_000,
    firstUserPrompt: "리팩터링 해줘",
    filesRead: [],
    filesEdited: [],
    bashCommands: [],
    compactionBoundaries: [],
    injectedRulesDigest: null,
    truncated: false,
    skippedRecords: 0,
    ...overrides,
  };
}

function makeLink(
  sessionId: string,
  commitIds: string[],
  confidence: LinkConfidence = "high",
): SessionCommitLink {
  return {
    sessionId,
    sessionPath: `/logs/${sessionId}.jsonl`,
    commitIds,
    confidence,
    basis: ["cwd"],
  };
}

function linkMap(...links: SessionCommitLink[]): Map<string, SessionCommitLink> {
  const map = new Map<string, SessionCommitLink>();
  for (const link of links) {
    for (const commitId of link.commitIds) map.set(commitId, link);
  }
  return map;
}

function edit(path: string) {
  return {
    path,
    editCount: 1,
    firstEditAt: 0,
    lastEditAt: 0,
    wasReadFirst: true,
    afterCompaction: false,
    bySubagent: false,
    viaBash: false,
  };
}

describe("groupCommitsBySession", () => {
  it("buckets commits under the session that produced them", () => {
    const commits = [makeCommit("c3"), makeCommit("c2"), makeCommit("c1")];
    const session = makeSession("s1", { filesEdited: [edit("a.ts"), edit("b.ts")] });

    const { groups, unlinked } = groupCommitsBySession({
      sessions: [session],
      linkByCommit: linkMap(makeLink("s1", ["c3", "c1"])),
      commits,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("/logs/s1.jsonl");
    expect(groups[0].commits.map((c) => c.id)).toEqual(["c3", "c1"]);
    expect(groups[0].fileCount).toBe(2);
    expect(groups[0].durationMs).toBe(47 * 60_000);
    expect(unlinked.map((c) => c.id)).toEqual(["c2"]);
  });

  it("keeps groups in history order, not session-list order", () => {
    const commits = [makeCommit("c3"), makeCommit("c2"), makeCommit("c1")];

    const { groups } = groupCommitsBySession({
      // Backend order is deliberately reversed to prove it does not decide.
      sessions: [makeSession("s2"), makeSession("s1")],
      linkByCommit: linkMap(makeLink("s1", ["c3"]), makeLink("s2", ["c2", "c1"])),
      commits,
    });

    expect(groups.map((g) => g.session.sessionId)).toEqual(["s1", "s2"]);
  });

  it("never groups a low-confidence link (§7-⑧)", () => {
    const commits = [makeCommit("c1")];

    const { groups, unlinked } = groupCommitsBySession({
      sessions: [makeSession("s1")],
      linkByCommit: linkMap(makeLink("s1", ["c1"], "low")),
      commits,
    });

    expect(groups).toHaveLength(0);
    expect(unlinked.map((c) => c.id)).toEqual(["c1"]);
  });

  it("reports the weakest confidence that put commits in a group", () => {
    const commits = [makeCommit("c2"), makeCommit("c1")];
    const links = new Map<string, SessionCommitLink>([
      ["c2", makeLink("s1", ["c2"], "high")],
      ["c1", makeLink("s1", ["c1"], "medium")],
    ]);

    const { groups } = groupCommitsBySession({
      sessions: [makeSession("s1")],
      linkByCommit: links,
      commits,
    });

    expect(groups[0].confidence).toBe("medium");
  });

  it("treats a link to an unknown session as unattributed rather than dropping the commit", () => {
    const commits = [makeCommit("c1")];

    const { groups, unlinked } = groupCommitsBySession({
      sessions: [],
      linkByCommit: linkMap(makeLink("ghost", ["c1"])),
      commits,
    });

    expect(groups).toHaveLength(0);
    expect(unlinked.map((c) => c.id)).toEqual(["c1"]);
  });

  it("loses no commit: every input lands in a group or in unlinked", () => {
    const commits = [makeCommit("c3"), makeCommit("c2"), makeCommit("c1")];

    const { groups, unlinked } = groupCommitsBySession({
      sessions: [makeSession("s1")],
      linkByCommit: linkMap(makeLink("s1", ["c2"])),
      commits,
    });

    const seen = [...groups.flatMap((g) => g.commits), ...unlinked].map((c) => c.id);
    expect(seen.sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps the unlinked bucket key distinct from any session path", () => {
    expect(UNLINKED_GROUP_KEY).not.toContain("/");
  });
});
