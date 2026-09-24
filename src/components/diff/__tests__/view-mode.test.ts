import { describe, it, expect } from "vitest";
import { defaultMode, diffResetKey } from "../view-mode";

describe("defaultMode", () => {
  it("마크다운은 문서 보기로 연다", () => {
    expect(defaultMode("README.md", false, "split")).toBe("document");
  });

  it("그 외 파일은 마지막으로 고른 줄 보기를 따른다", () => {
    expect(defaultMode("src/a.ts", false, "split")).toBe("split");
    expect(defaultMode("src/a.ts", false, "unified")).toBe("unified");
    expect(defaultMode("README.md", true, "split")).toBe("split");
  });
});

describe("diffResetKey", () => {
  it("같은 파일을 다시 조회해도 키가 같다(보기 상태 유지)", () => {
    expect(diffResetKey("a.ts", false, false)).toBe(diffResetKey("a.ts", false, false));
  });

  it("파일이나 staged 여부가 바뀌면 키가 달라진다", () => {
    const base = diffResetKey("a.ts", false, false);
    expect(diffResetKey("b.ts", false, false)).not.toBe(base);
    expect(diffResetKey("a.ts", true, false)).not.toBe(base);
  });
});
