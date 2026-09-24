import { describe, expect, it } from "vitest";
import { getGitHubWebUrl, parseGitHubUrl } from "@/lib/utils";

describe("parseGitHubUrl", () => {
  it.each([
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo",
    "https://github.com/owner/repo/",
    "http://github.com/owner/repo.git",
    "https://user@github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "git@github.com:owner/repo",
    "ssh://git@github.com/owner/repo.git",
    "ssh://git@github.com:22/owner/repo",
  ])("parses %s", (url) => {
    expect(parseGitHubUrl(url)).toEqual({ owner: "owner", repo: "repo" });
  });

  it("keeps dots in repository names", () => {
    expect(parseGitHubUrl("https://github.com/vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
    expect(parseGitHubUrl("git@github.com:user/user.github.io")).toEqual({
      owner: "user",
      repo: "user.github.io",
    });
  });

  it.each([
    "https://gitlab.com/owner/repo.git",
    "https://github.com.evil.com/owner/repo",
    "https://evil.com/github.com/owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo/extra",
  ])("rejects %s", (url) => {
    expect(parseGitHubUrl(url)).toBeNull();
  });
});

describe("getGitHubWebUrl", () => {
  it("builds the web URL for a dotted repo over SSH", () => {
    expect(getGitHubWebUrl("git@github.com:vercel/next.js.git")).toBe(
      "https://github.com/vercel/next.js",
    );
  });
});
