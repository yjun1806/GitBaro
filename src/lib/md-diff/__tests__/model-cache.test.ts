import { describe, it, expect, beforeEach } from "vitest";
import { findCached, putCached, clearCache, type CachedResult } from "../model-cache";
import type { DocDiffModel } from "../types";

/**
 * 캐시는 잘못 맞으면 **다른 파일의 diff를 보여준다** — 조용히 틀린 화면이라 가장 나쁜 실패다.
 * 그래서 "언제 맞고 언제 안 맞는가"를 못 박는다.
 */

const model = (tag: string) => ({ blocks: [], stats: { inserted: 0, deleted: 0, modified: 0, moved: 0 }, tag }) as unknown as DocDiffModel;
const ok = (tag: string): CachedResult => ({ ok: true, model: model(tag) });

beforeEach(clearCache);

describe("문서 diff 모델 캐시", () => {
  it("같은 원문 쌍이면 맞는다", () => {
    putCached("old", "new", ok("A"));
    expect(findCached("old", "new")).toEqual(ok("A"));
  });

  it("한쪽이라도 다르면 안 맞는다", () => {
    putCached("old", "new", ok("A"));
    expect(findCached("old", "other")).toBeNull();
    expect(findCached("other", "new")).toBeNull();
  });

  it("양쪽이 뒤바뀌면 안 맞는다", () => {
    // 순서를 무시하면 방향이 반대인 diff를 그대로 보여주게 된다.
    putCached("A", "B", ok("정방향"));
    expect(findCached("B", "A")).toBeNull();
  });

  it("빈 원문도 정상적인 키다", () => {
    // 파일 생성(옛쪽이 빈 문자열)은 흔한 경우다.
    putCached("", "new", ok("생성"));
    expect(findCached("", "new")).toEqual(ok("생성"));
    expect(findCached("", "")).toBeNull();
  });

  it("같은 키를 다시 넣으면 덮어쓴다", () => {
    putCached("old", "new", ok("옛것"));
    putCached("old", "new", ok("새것"));
    expect(findCached("old", "new")).toEqual(ok("새것"));
  });

  it("실패도 보관한다", () => {
    // 타임아웃은 문서 크기에서 오는 결정론적 결과다 — 다시 눌러도 또 8초를 버릴 뿐이다.
    putCached("old", "new", { ok: false, error: "timeout" });
    expect(findCached("old", "new")).toEqual({ ok: false, error: "timeout" });
  });

  it("용량을 넘으면 오래된 것부터 버린다", () => {
    for (let i = 0; i < 5; i++) putCached(`old${i}`, `new${i}`, ok(`${i}`));
    expect(findCached("old0", "new0")).toBeNull();
    expect(findCached("old1", "new1")).toEqual(ok("1"));
    expect(findCached("old4", "new4")).toEqual(ok("4"));
  });

  it("조회할 때마다 같은 객체를 돌려준다", () => {
    // 호출부가 이 참조 안정성에 기대어 페인트를 건너뛴다 — 매번 새 객체면 렌더마다
    // DOM을 다시 그려 펼쳐 둔 삭제 묶음이 도로 접힌다.
    const result = ok("A");
    putCached("old", "new", result);
    expect(findCached("old", "new")).toBe(result);
    expect(findCached("old", "new")).toBe(findCached("old", "new"));
  });

  it("조회는 보관 순서를 바꾸지 않는다", () => {
    // 렌더 중에 불리므로 부작용이 없어야 한다.
    for (let i = 0; i < 4; i++) putCached(`old${i}`, `new${i}`, ok(`${i}`));
    findCached("old0", "new0"); // 가장 오래된 것을 조회해도 승격되지 않는다
    putCached("old9", "new9", ok("9"));
    expect(findCached("old0", "new0")).toBeNull();
  });
});
