/**
 * 커밋 제목에 적힌 이슈 키(Jira 형식 `ABC-123`). 파일별 보기가 「XMS-371, XMS-364가 바꿈」처럼
 * 여러 작업이 한 파일을 건드렸는지 보여 줄 때 쓴다.
 *
 * - `[ABC-123]`, `ABC-123` → `ABC-123`
 * - `[ABC-123/456]` → `ABC-123`, `ABC-456` (같은 프로젝트의 번호를 `/`로 이어 적은 것)
 *
 * 프로젝트 키는 대문자로 시작하는 2~10자(대문자·숫자)다. `UTF-8`·`SHA-256`처럼 이슈가 아닌 흔한 표기는 뺀다.
 */

// 앞 경계는 뒤보기(lookbehind) 대신 그룹으로 잡는다: macOS 10.15의 WebKit은 뒤보기를 모른다.
const TICKET = /(^|[^A-Za-z0-9-])([A-Z][A-Z0-9]{1,9})-(\d+)((?:\/\d+)*)(?![A-Za-z0-9])/g;

const NOT_TICKETS = new Set(["UTF", "SHA", "ISO", "CVE", "RFC", "HTTP", "TLS", "SSL", "MD5", "ES"]);

/** 제목 하나의 이슈 키. 나온 순서대로, 겹치지 않게. */
export function ticketKeysOf(subject: string): string[] {
  const keys: string[] = [];
  for (const [, , project, first, rest] of subject.matchAll(TICKET)) {
    if (NOT_TICKETS.has(project)) continue;
    for (const num of [first, ...rest.split("/").filter(Boolean)]) {
      const key = `${project}-${num}`;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** 여러 제목에 걸친 이슈 키. 나온 순서대로, 겹치지 않게. */
export function distinctTicketKeys(subjects: readonly string[]): string[] {
  return [...new Set(subjects.flatMap(ticketKeysOf))];
}
