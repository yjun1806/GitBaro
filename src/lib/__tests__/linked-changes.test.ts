import { describe, expect, it } from "vitest";
import {
  MAX_FILES_PER_TOKEN,
  fileKey,
  findLinkedChanges,
  isLinkableFile,
  linkTokens,
  splitByToken,
  type LinkSource,
} from "../linked-changes";

const APP = "/work/xames-app";
const API = "/work/xames-backend";
const DESIGN = "/work/xames-design";

function src(repoPath: string, filePath: string, addedLines: string[]): LinkSource {
  return { repoPath, filePath, addedLines };
}

function tokensOf(links: ReturnType<typeof findLinkedChanges>, repoPath: string, filePath: string) {
  return (links.get(fileKey(repoPath, filePath)) ?? []).map((l) => l.token);
}

describe("linkTokens", () => {
  it("keeps string literals and compound identifiers of 8+ characters", () => {
    const tokens = linkTokens('  http.get<NotificationSettings>("/api/v1/notifications/settings");');
    expect(tokens).toContain("/api/v1/notifications/settings");
    expect(tokens).toContain("NotificationSettings");
  });

  it("drops tokens shorter than the minimum length, even when they look like names", () => {
    // 7자: 구분자가 있어도 짧으면 버린다.
    expect(linkTokens('const a = "api/v1x";')).toEqual([]);
    expect(linkTokens("badg.fg = sm.rgb;")).toEqual([]);
    expect(linkTokens("getUser();")).toEqual([]);
  });

  it("drops plain single words written as code, even when they are long enough", () => {
    expect(linkTokens("  return notifications > children;")).toEqual([]);
    expect(linkTokens("function settings() {}")).toEqual([]);
  });

  it("keeps a quoted word of 8+ characters and the words of a quoted path", () => {
    expect(linkTokens('  @Get("settings")')).toEqual(["settings"]);
    expect(linkTokens('http.get("/api/v1/notifications/settings");')).toEqual(
      expect.arrayContaining(["/api/v1/notifications/settings", "notifications", "settings"]),
    );
    // 7자 낱말, 흔한 값, 해시, URL의 마디는 받지 않는다.
    expect(linkTokens('@Get("profile")')).toEqual([]);
    expect(linkTokens('<input type="checkbox" />')).toEqual([]);
    expect(linkTokens('rev = "deadbeef12345678";')).toEqual([]);
    expect(linkTokens('fetch("https://example.com/somewhere")')).toEqual(["https://example.com/somewhere"]);
  });

  it("drops hashes, generic calls and generic prefixes", () => {
    expect(linkTokens('sha = "deadbeef12345678";')).toEqual([]);
    expect(linkTokens("console.error(err); JSON.stringify(x); http.get(url);")).toEqual([]);
    // this. 은 떼고 나머지를 본다.
    expect(linkTokens("this.settings.findFor(user.id)")).toContain("settings.findFor");
  });

  it("ignores import and require lines", () => {
    expect(linkTokens('import { useQuery } from "@tanstack/react-query";')).toEqual([]);
    expect(linkTokens('const x = require("notification-service");')).toEqual([]);
    expect(linkTokens("use crate::notification_settings::Store;")).toEqual([]);
  });
});

describe("findLinkedChanges", () => {
  it("links files in different repositories that add the same string", () => {
    const links = findLinkedChanges([
      src(APP, "src/api/notifications.ts", ['  http.get<Settings>("/api/v1/notifications/settings");']),
      src(API, "src/notifications/settings.controller.ts", ['const ROUTE = "/api/v1/notifications/settings";']),
      src(DESIGN, "tokens/color.json", ['  "notification.badge": "#e5700b",']),
    ]);
    const appLinks = links.get(fileKey(APP, "src/api/notifications.ts")) ?? [];
    expect(appLinks[0].token).toBe("/api/v1/notifications/settings");
    expect(appLinks[0].others).toEqual([{ repoPath: API, filePath: "src/notifications/settings.controller.ts" }]);
    expect(tokensOf(links, DESIGN, "tokens/color.json")).toEqual([]);
  });

  it("does not link through a shared token shorter than the minimum length", () => {
    const links = findLinkedChanges([
      src(APP, "a.ts", ['fetch("/api/v1");', "badg.fg = 1;", "user_id = 2;"]),
      src(API, "b.ts", ['route("/api/v1");', "badg.fg = 1;", "user_id = 2;"]),
    ]);
    expect(links.size).toBe(0);
  });

  it("links on exactly the minimum length", () => {
    const links = findLinkedChanges([
      src(APP, "a.ts", ["theme.bg = x;"]),
      src(API, "b.ts", ["y = theme.bg;"]),
    ]);
    expect(tokensOf(links, APP, "a.ts")).toEqual(["theme.bg"]);
  });

  it("does not link files inside the same repository", () => {
    const links = findLinkedChanges([
      src(APP, "a.ts", ['const key = "notification.badge";']),
      src(APP, "b.ts", ['read("notification.badge");']),
    ]);
    expect(links.size).toBe(0);
  });

  it("drops a string that appears in too many files", () => {
    const sources = Array.from({ length: MAX_FILES_PER_TOKEN + 1 }, (_, i) =>
      src(`/work/repo-${i}`, "x.ts", ['log("shared.everywhere");']),
    );
    expect(findLinkedChanges(sources).size).toBe(0);
  });

  it("links a route split across a path literal and a quoted word (D7 example)", () => {
    const links = findLinkedChanges([
      src(APP, "src/api/notifications.ts", ['  http.get<NotificationSettings>("/api/v1/notifications/settings");']),
      src(API, "src/notifications/settings.controller.ts", ['  @Get("settings")', "  getSettings(@User() user) {"]),
    ]);
    expect(tokensOf(links, API, "src/notifications/settings.controller.ts")).toEqual(["settings"]);
    expect(tokensOf(links, APP, "src/api/notifications.ts")).toEqual(["settings"]);
  });

  it("does not link package names added to dependency manifests", () => {
    expect(isLinkableFile("package.json")).toBe(false);
    expect(isLinkableFile("apps/web/package.json")).toBe(false);
    expect(isLinkableFile("src-tauri/Cargo.toml")).toBe(false);
    const links = findLinkedChanges([
      src(APP, "package.json", ['    "@tanstack/react-query": "^5.0.0",', '    "react-dom": "^19.0.0",']),
      src(API, "package.json", ['    "@tanstack/react-query": "^5.0.0",', '    "react-dom": "^19.0.0",']),
      src(APP, "Cargo.toml", ['serde_json = "1.0"']),
      src(API, "Cargo.toml", ['serde_json = "1.0"']),
    ]);
    expect(links.size).toBe(0);
  });

  it("skips lock files", () => {
    expect(isLinkableFile("pnpm-lock.yaml")).toBe(false);
    expect(isLinkableFile("web/package-lock.json")).toBe(false);
    expect(isLinkableFile("src/api/notifications.ts")).toBe(true);
    const links = findLinkedChanges([
      src(APP, "pnpm-lock.yaml", ["  /notification-kit@1.2.0:"]),
      src(API, "pnpm-lock.yaml", ["  /notification-kit@1.2.0:"]),
    ]);
    expect(links.size).toBe(0);
  });

  it("keeps only the longer token when a shorter one links the same files", () => {
    const links = findLinkedChanges([
      src(APP, "a.ts", ['get("/api/v1/notifications/settings")']),
      src(API, "b.ts", ['put("/api/v1/notifications/settings")']),
    ]);
    // 따옴표 안 문자열과 앞의 / 를 뗀 덩어리가 같은 파일을 잇는다 → 긴 쪽만.
    expect(tokensOf(links, APP, "a.ts")).toEqual(["/api/v1/notifications/settings"]);
  });
});

describe("splitByToken", () => {
  it("marks every occurrence of the token", () => {
    expect(splitByToken('a "x.y.zzzzz" b x.y.zzzzz', "x.y.zzzzz")).toEqual([
      { text: 'a "', match: false },
      { text: "x.y.zzzzz", match: true },
      { text: '" b ', match: false },
      { text: "x.y.zzzzz", match: true },
    ]);
  });
});
