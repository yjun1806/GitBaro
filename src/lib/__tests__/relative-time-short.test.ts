import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { formatRelativeTimeShort, splitConventionalPrefix } from "../utils";

describe("formatRelativeTimeShort", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("drops 「전」 so the narrow list keeps room for the title", () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTimeShort(now - 10)).toBe("방금");
    expect(formatRelativeTimeShort(now - 5 * 60)).toBe("5분");
    expect(formatRelativeTimeShort(now - 4 * 3600)).toBe("4시간");
    expect(formatRelativeTimeShort(now - 3 * 86400)).toBe("3일");
  });
});

describe("splitConventionalPrefix", () => {
  it("splits type and rest, dropping the scope and bang", () => {
    expect(splitConventionalPrefix("fix(graph): tidy labels")).toEqual({ type: "fix", rest: "tidy labels" });
    expect(splitConventionalPrefix("feat!: breaking")).toEqual({ type: "feat", rest: "breaking" });
  });

  it("leaves other titles alone", () => {
    expect(splitConventionalPrefix("Merge branch 'main'")).toBeNull();
    expect(splitConventionalPrefix("XMS-371 fix login")).toBeNull();
  });
});
