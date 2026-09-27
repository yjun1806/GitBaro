// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import i18n from "@/i18n/config";
import { followNote } from "../follow-note";
import type { CommitTouch, WipFile } from "@/types";

const { t } = i18n;

const commit = (subject: string, authorTime: number): CommitTouch => ({
  oid: "deadbeef",
  shortOid: "deadbee",
  subject,
  authorTime,
  parentOid: null,
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  isBinary: false,
  tooLarge: false,
});

const file = (extra: Partial<Pick<WipFile, "status" | "insertions" | "deletions">> = {}) => ({
  status: "modified" as const,
  insertions: 0,
  deletions: 0,
  ...extra,
});

const nowSecs = () => Math.floor(Date.now() / 1000);

describe("followNote", () => {
  it("names the leading ticket key of the most recent unpushed commit", () => {
    const commits = [commit("[XMS-371] tidy up", nowSecs() - 480), commit("older, no ticket", nowSecs() - 9_000)];
    expect(followNote(t, file(), commits)).toContain("XMS-371");
  });

  it("only looks at the most recent commit, not older ones with a ticket key of their own", () => {
    // The newest commit has no ticket key; an older one does. The note is about the newest
    // commit specifically, so it falls back to that commit's subject rather than reaching back.
    const commits = [commit("tidy up more", nowSecs() - 60), commit("[XMS-371] older", nowSecs() - 9_000)];
    const note = followNote(t, file(), commits);
    expect(note).toContain("tidy up more");
    expect(note).not.toContain("XMS-371");
  });

  it("falls back to the commit subject when it has no leading ticket key", () => {
    const commits = [commit("tidy up the login form", nowSecs() - 60)];
    const note = followNote(t, file(), commits);
    expect(note).toContain("tidy up the login form");
  });

  it("notes a new file when it has no unpushed commit yet", () => {
    expect(followNote(t, file({ status: "added" }), [])).toBe(t("live.followLineNewFile"));
  });

  it("notes the changed line count when there is no commit and no new-file status", () => {
    const note = followNote(t, file({ insertions: 12, deletions: 3 }), []);
    expect(note).toBe(t("live.followLineSize", { add: 12, del: 3 }));
  });

  it("has nothing to note for an unmodified, uncommitted file", () => {
    expect(followNote(t, file(), [])).toBeNull();
  });

  it("prefers the commit fact over the size fallback", () => {
    const commits = [commit("[XMS-371] tidy up", nowSecs() - 480)];
    const note = followNote(t, file({ insertions: 12, deletions: 3 }), commits);
    expect(note).toContain("XMS-371");
    expect(note).not.toContain("+12");
  });
});
