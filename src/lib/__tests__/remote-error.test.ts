import { describe, expect, it } from "vitest";
import { remoteErrorKey, signInErrorAccount } from "@/lib/remote-error";

describe("signInErrorAccount", () => {
  it("returns the account of a TokenExpired error", () => {
    expect(
      signInErrorAccount({ type: "TokenExpired", message: "GitHub sign-in for work is missing", accountId: "work" }),
    ).toBe("work");
  });

  it("ignores other errors, including auth-like git messages", () => {
    expect(signInErrorAccount({ type: "GitCli", message: "unable to get password from user" })).toBeNull();
    expect(signInErrorAccount({ type: "TokenExpired", message: "no account" })).toBeNull();
    expect(signInErrorAccount("TokenExpired")).toBeNull();
    expect(signInErrorAccount(null)).toBeNull();
  });
});

describe("remoteErrorKey", () => {
  it("maps remote selection codes and leaves other messages alone", () => {
    expect(remoteErrorKey("no_upstream:main")).toBe("sync.noUpstreamError");
    expect(remoteErrorKey("detached_head")).toBe("sync.detachedHeadError");
    expect(remoteErrorKey("credential_prompt_blocked")).toBe("sync.credentialPromptBlocked");
    expect(remoteErrorKey("unable to get password from user")).toBeNull();
  });
});
