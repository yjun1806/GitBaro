import { describe, expect, it } from "vitest";
import {
  ALIAS_MAX_LENGTH,
  normalizeRepoPrefs,
  repoAvatarColor,
  repoDisplayName,
  sanitizeRepoPrefsMap,
  withRepoPrefs,
} from "@/lib/repo-prefs";
import { AVATAR_HUES, avatarColor, avatarColorFromHue } from "@/lib/avatar-color";

const APP = "/work/app";
const repo = { path: APP, name: "app" };

describe("normalizeRepoPrefs", () => {
  it("trims the display name, caps its length and drops an empty one", () => {
    expect(normalizeRepoPrefs({ alias: "  Shop  " })).toEqual({ alias: "Shop" });
    expect(normalizeRepoPrefs({ alias: "x".repeat(ALIAS_MAX_LENGTH + 5) })?.alias).toHaveLength(ALIAS_MAX_LENGTH);
    expect(normalizeRepoPrefs({ alias: "   " })).toBeNull();
  });

  it("keeps only palette colors and known notification choices", () => {
    expect(
      normalizeRepoPrefs({
        hue: 13,
        notify: { newCommits: "yes", ciFailures: "off", other: "on" },
      }),
    ).toEqual({ notify: { ciFailures: "off" } });
    expect(normalizeRepoPrefs({ hue: AVATAR_HUES[2] })).toEqual({ hue: AVATAR_HUES[2] });
  });

  it("drops the removed compare-base setting from old stored values without failing", () => {
    expect(normalizeRepoPrefs({ alias: "Shop", compareBase: "develop" })).toEqual({ alias: "Shop" });
    expect(normalizeRepoPrefs({ compareBase: "develop" })).toBeNull();
    expect(sanitizeRepoPrefsMap({ [APP]: { compareBase: "develop", hue: AVATAR_HUES[1] } })).toEqual({
      [APP]: { hue: AVATAR_HUES[1] },
    });
  });

  it("returns null for values that are not objects", () => {
    expect(normalizeRepoPrefs(null)).toBeNull();
    expect(normalizeRepoPrefs("Shop")).toBeNull();
    expect(normalizeRepoPrefs(["Shop"])).toBeNull();
  });
});

describe("sanitizeRepoPrefsMap", () => {
  it("keeps good entries, drops broken or empty ones", () => {
    expect(
      sanitizeRepoPrefsMap({
        [APP]: { alias: "Shop" },
        "/work/empty": {},
        "/work/broken": 42,
      }),
    ).toEqual({ [APP]: { alias: "Shop" } });
    expect(sanitizeRepoPrefsMap(undefined)).toEqual({});
    expect(sanitizeRepoPrefsMap([])).toEqual({});
  });
});

describe("withRepoPrefs", () => {
  it("merges a patch without touching other fields or other repositories", () => {
    const before = { [APP]: { alias: "Shop", hue: AVATAR_HUES[0] }, "/work/api": { alias: "API" } };
    const after = withRepoPrefs(before, APP, { notify: { newCommits: "off" } });
    expect(after).toEqual({
      [APP]: { alias: "Shop", hue: AVATAR_HUES[0], notify: { newCommits: "off" } },
      "/work/api": { alias: "API" },
    });
    expect(before[APP]).toEqual({ alias: "Shop", hue: AVATAR_HUES[0] });
  });

  it("clears a field given as undefined and removes the entry once nothing is left", () => {
    const one = withRepoPrefs({ [APP]: { alias: "Shop", hue: AVATAR_HUES[0] } }, APP, { alias: undefined });
    expect(one).toEqual({ [APP]: { hue: AVATAR_HUES[0] } });
    expect(withRepoPrefs(one, APP, { hue: undefined })).toEqual({});
  });
});

describe("display helpers", () => {
  it("shows the display name when set, the folder name otherwise", () => {
    expect(repoDisplayName(repo, {})).toBe("app");
    expect(repoDisplayName(repo, { [APP]: { alias: "Shop" } })).toBe("Shop");
  });

  it("uses the chosen avatar color, or the color derived from the path", () => {
    expect(repoAvatarColor(APP, {})).toEqual(avatarColor(APP));
    expect(repoAvatarColor(APP, { [APP]: { hue: AVATAR_HUES[3] } })).toEqual(avatarColorFromHue(AVATAR_HUES[3]));
  });
});
