import { describe, expect, it } from "vitest";
import { distinctTicketKeys, ticketKeysOf } from "../ticket-keys";

describe("ticketKeysOf", () => {
  it("reads a key with or without brackets", () => {
    expect(ticketKeysOf("[XMS-371] fix login")).toEqual(["XMS-371"]);
    expect(ticketKeysOf("XMS-371 fix login")).toEqual(["XMS-371"]);
    expect(ticketKeysOf("fix login (XMS-371)")).toEqual(["XMS-371"]);
    expect(ticketKeysOf("feat(auth): XMS-371: login")).toEqual(["XMS-371"]);
  });

  it("expands numbers joined with a slash into keys of the same project", () => {
    expect(ticketKeysOf("[XMS-371/364] shared fix")).toEqual(["XMS-371", "XMS-364"]);
    expect(ticketKeysOf("[AB-1/2/3] x")).toEqual(["AB-1", "AB-2", "AB-3"]);
  });

  it("keeps several keys in order, without repeats", () => {
    expect(ticketKeysOf("XMS-2 and OPS-10, again XMS-2")).toEqual(["XMS-2", "OPS-10"]);
  });

  it("ignores text that only looks like a key", () => {
    expect(ticketKeysOf("")).toEqual([]);
    expect(ticketKeysOf("no ticket here")).toEqual([]);
    expect(ticketKeysOf("xms-371 lowercase")).toEqual([]);
    expect(ticketKeysOf("X-1 single letter project")).toEqual([]);
    expect(ticketKeysOf("read files as UTF-8 and hash with SHA-256")).toEqual([]);
    expect(ticketKeysOf("bump to v2-3 and ABC-12x")).toEqual([]);
    expect(ticketKeysOf("CVE-2024-1234 patched")).toEqual([]);
  });
});

describe("distinctTicketKeys", () => {
  it("collects keys across commit subjects", () => {
    expect(distinctTicketKeys(["[XMS-371] a", "[XMS-364] b", "XMS-371 c", "chore: tidy"])).toEqual([
      "XMS-371",
      "XMS-364",
    ]);
  });

  it("returns a single key when every commit belongs to the same ticket", () => {
    expect(distinctTicketKeys(["[XMS-1] a", "[XMS-1] b"])).toEqual(["XMS-1"]);
  });
});
