import { describe, expect, it } from "vitest";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";

describe("avatarColor", () => {
  it("같은 입력은 항상 같은 색을 반환한다 (결정적)", () => {
    expect(avatarColor("/repos/gitbaro")).toEqual(avatarColor("/repos/gitbaro"));
  });

  it("다른 입력은 (대개) 다른 색상을 낸다", () => {
    const a = avatarColor("/repos/alpha");
    const b = avatarColor("/repos/beta");
    expect(a.background).not.toBe(b.background);
  });

  it("전경색은 흰색으로 고정된다", () => {
    expect(avatarColor("anything").foreground).toBe("hsl(0, 0%, 100%)");
  });

  it("배경색은 유효한 hsl 문자열이다", () => {
    expect(avatarColor("seed").background).toMatch(/^hsl\(\d{1,3}, 55%, 45%\)$/);
  });
});

describe("avatarInitial", () => {
  it("첫 글자를 대문자로 반환한다", () => {
    expect(avatarInitial("gitbaro")).toBe("G");
  });

  it("앞뒤 공백을 무시한다", () => {
    expect(avatarInitial("  repo")).toBe("R");
  });

  it("빈 문자열은 물음표로 대체한다", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });
});
