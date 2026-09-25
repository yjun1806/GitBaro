import { describe, expect, it } from "vitest";
import { gitHubBranchUrl, gitHubCommitUrl, gitHubRepoUrl, joinRepoPath } from "@/lib/utils";

describe("GitHub links for menus", () => {
  it("prefers origin among GitHub remotes and ignores other hosts", () => {
    expect(
      gitHubRepoUrl([
        { name: "upstream", url: "git@github.com:up/app.git" },
        { name: "origin", url: "https://github.com/me/app.git" },
      ]),
    ).toBe("https://github.com/me/app");
    expect(gitHubRepoUrl([{ name: "origin", url: "https://gitlab.com/me/app.git" }])).toBeNull();
    expect(gitHubRepoUrl([])).toBeNull();
  });

  it("builds commit and branch links, dropping the remote name of a remote branch", () => {
    const repo = "https://github.com/me/app";
    expect(gitHubCommitUrl(repo, "abc")).toBe("https://github.com/me/app/commit/abc");
    expect(gitHubBranchUrl(repo, "feat/x")).toBe("https://github.com/me/app/tree/feat/x");
    expect(gitHubBranchUrl(repo, "origin/feat/x", true)).toBe("https://github.com/me/app/tree/feat/x");
    expect(gitHubBranchUrl(repo, "fix#1")).toBe("https://github.com/me/app/tree/fix%231");
  });

  it("joins a repository path and a relative path with one slash", () => {
    expect(joinRepoPath("/r/app/", "/src/a.ts")).toBe("/r/app/src/a.ts");
    expect(joinRepoPath("/r/app", "src/a.ts")).toBe("/r/app/src/a.ts");
  });
});
