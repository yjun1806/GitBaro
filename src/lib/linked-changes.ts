/**
 * 연결된 변경(D7): 서로 다른 저장소의 파일이 같은 문자열을 새로 추가했는지 찾는다.
 *
 * 판정은 추정이다. 추가된 줄에서 8자 이상의 식별자·문자열을 뽑아, 다른 저장소의 추가된 줄에도
 * 똑같이 있으면 두 파일을 잇는다. 잘못된 연결을 줄이려고 아래를 뺀다.
 * - 8자보다 짧은 것, 글자가 없는 것, 16진수 해시처럼 보이는 것
 * - 코드에 그냥 쓴 낱말 하나(`children`, `function`): 구분자(`. / - _ :`)나 camelCase가 있어야 한다.
 *   따옴표 안 문자열 전체이거나 따옴표 안 경로의 한 마디인 낱말(`@Get("settings")`,
 *   `"/api/v1/notifications/settings"`의 `settings`)은 받는다. 라우트·키 이름은 이렇게 나뉘어 쓰인다.
 *   이때도 흔한 값(`checkbox`, `password` 등)은 뺀다.
 * - import·use·require 줄, 의존성 선언 파일(`package.json`, `Cargo.toml` 등)과 잠금 파일·압축 파일:
 *   패키지 이름은 도메인 연결이 아니다
 * - 너무 많은 파일에 나오는 문자열(흔한 표현)
 * 같은 저장소 안의 파일끼리는 잇지 않는다(import 하나로 모두 이어지기 때문이다).
 */

/** 연결로 인정하는 가장 짧은 길이. */
export const MIN_LINK_TOKEN_LENGTH = 8;
/** 이보다 많은 파일에 나오는 문자열은 흔한 표현으로 보고 버린다. */
export const MAX_FILES_PER_TOKEN = 6;
/** 파일 하나에 붙이는 연결 수 상한. */
export const MAX_LINKS_PER_FILE = 5;
/** 파일 하나에서 보는 추가된 줄 수 상한과 줄 길이 상한(압축된 코드 대비). */
const MAX_LINES_PER_FILE = 2000;
const MAX_LINE_LENGTH = 400;

export interface FileRef {
  repoPath: string;
  filePath: string;
}

/** 파일 하나와 그 파일에 새로 추가된 줄. */
export interface LinkSource extends FileRef {
  addedLines: readonly string[];
}

/** 파일 하나의 연결: 같은 `token`을 추가한 다른 저장소의 파일들. */
export interface FileLink {
  token: string;
  others: readonly FileRef[];
}

/** 이 목록은 연결 후보가 되기에는 너무 흔하다. 앞부분이 이것이면 떼고 나머지를 본다. */
const GENERIC_PREFIXES = [
  "this.",
  "self.",
  "super.",
  "console.",
  "JSON.",
  "Object.",
  "Array.",
  "Promise.",
  "Math.",
  "Number.",
  "String.",
  "React.",
  "window.",
  "document.",
  "process.env.",
  "import.meta.env.",
];

const GENERIC_TOKENS = new Set([
  "http.get",
  "http.post",
  "http.put",
  "http.patch",
  "http.delete",
  "axios.get",
  "axios.post",
  "res.json",
  "res.status",
  "req.body",
  "req.params",
  "req.query",
  "module.exports",
  "className",
  "useState",
  "useEffect",
  "useCallback",
  "useRef",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "addEventListener",
  "removeEventListener",
  "preventDefault",
  "stopPropagation",
  "querySelector",
  "getElementById",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "localStorage",
  "sessionStorage",
  "https://",
  "http://",
]);

/** 따옴표 안 낱말이라도 연결 후보가 되기에는 너무 흔한 값. */
const COMMON_QUOTED_WORDS = new Set([
  "function",
  "undefined",
  "boolean",
  "children",
  "checkbox",
  "password",
  "username",
  "required",
  "disabled",
  "readonly",
  "relative",
  "absolute",
  "vertical",
  "horizontal",
  "transparent",
  "inherit",
  "primary",
  "secondary",
  "container",
  "description",
  "position",
  "optional",
  "response",
  "dependencies",
  "development",
  "production",
  "resolved",
  "integrity",
  "application",
  "keywords",
  "repository",
  "anonymous",
  "noopener",
  "noreferrer",
]);

const IMPORT_LINE = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|use\s+[\w:]+|#include\b|require\b|package\s+[\w.]+;?\s*$)|\brequire\s*\(/;

const SKIPPED_FILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum|bun\.lockb?)$|\.min\.(js|css)$|\.map$|\.snap$/;

/** 의존성 선언 파일. 여기 추가된 문자열은 대개 패키지 이름·버전이다. */
const MANIFEST_FILE =
  /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|requirements[\w.-]*\.txt|Pipfile|go\.mod|Gemfile|composer\.json|pubspec\.yaml|Podfile|pom\.xml|build\.gradle(\.kts)?|deno\.jsonc?)$/;

/** 연결을 찾을 만한 파일인가(잠금 파일, 의존성 선언 파일, 압축·생성 파일은 뺀다). */
export function isLinkableFile(filePath: string): boolean {
  return !SKIPPED_FILE.test(filePath) && !MANIFEST_FILE.test(filePath);
}

/** 앞뒤의 구분 문자(`/ . - :`)를 뗀다. */
function trimEdges(s: string): string {
  return s.replace(/^[^A-Za-z0-9_$]+/, "").replace(/[^A-Za-z0-9_$]+$/, "");
}

function stripGenericPrefix(s: string): string {
  let out = s;
  for (let changed = true; changed; ) {
    changed = false;
    for (const prefix of GENERIC_PREFIXES) {
      if (out.startsWith(prefix)) {
        out = out.slice(prefix.length);
        changed = true;
      }
    }
  }
  return out;
}

/** 평범한 낱말 하나가 아닌, 이름으로 쓰일 만한 문자열인가. */
function isDistinctive(token: string): boolean {
  if (token.length < MIN_LINK_TOKEN_LENGTH) return false;
  if (!/[A-Za-z]/.test(token)) return false;
  if (/^[0-9a-f]+$/i.test(token) && /\d/.test(token)) return false; // 해시
  if (GENERIC_TOKENS.has(token)) return false;
  const hasSeparator = /[./_:-]/.test(token.replace(/^\//, ""));
  const hasCamel = /[a-z0-9][A-Z]/.test(token);
  return hasSeparator || hasCamel;
}

function accept(raw: string, out: Set<string>): void {
  const token = stripGenericPrefix(raw);
  if (isDistinctive(token)) out.add(token);
}

/** 따옴표 안에 따로 쓰인 낱말(라우트 마디, 키 이름)이면 받는다. */
function acceptQuotedWord(word: string, out: Set<string>): void {
  if (word.length < MIN_LINK_TOKEN_LENGTH) return;
  if (!/^[A-Za-z][A-Za-z0-9_$-]*$/.test(word)) return;
  if (/^[0-9a-f]+$/i.test(word) && /\d/.test(word)) return; // 해시
  if (COMMON_QUOTED_WORDS.has(word.toLowerCase())) return;
  out.add(word);
}

/**
 * 줄 하나에서 연결 후보 문자열을 뽑는다. 따옴표 안 문자열은 그대로(`/api/v1/x`),
 * 코드는 식별자·경로 덩어리(`notification.badge`, `NotificationSettings`)로 본다.
 */
export function linkTokens(line: string): string[] {
  if (IMPORT_LINE.test(line)) return [];
  const text = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
  const out = new Set<string>();
  for (const m of text.matchAll(/"([^"\s]+)"|'([^'\s]+)'|`([^`\s]+)`/g)) {
    const literal = m[1] ?? m[2] ?? m[3] ?? "";
    if (!/^[A-Za-z0-9_$./:@-]+$/.test(literal)) continue;
    accept(literal, out);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(literal)) {
      for (const segment of literal.split("/")) acceptQuotedWord(segment, out);
    }
  }
  for (const m of text.matchAll(/[A-Za-z0-9_$./:-]+/g)) {
    accept(trimEdges(m[0]), out);
  }
  return [...out];
}

/** `findLinkedChanges` 결과의 키. */
export function fileKey(repoPath: string, filePath: string): string {
  return `${repoPath}\u0000${filePath}`;
}

function sameRefs(a: readonly FileRef[], b: readonly FileRef[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((r) => fileKey(r.repoPath, r.filePath)));
  return b.every((r) => keys.has(fileKey(r.repoPath, r.filePath)));
}

/**
 * 파일마다 다른 저장소 파일과의 연결을 찾는다. 결과는 `fileKey`별 연결 목록이고, 긴 문자열이 먼저다.
 * 같은 파일들과 잇는 문자열이 다른 문자열 안에 들어 있으면 긴 쪽만 남긴다.
 */
export function findLinkedChanges(sources: readonly LinkSource[]): Map<string, FileLink[]> {
  const filesByToken = new Map<string, FileRef[]>();
  for (const src of sources) {
    if (!isLinkableFile(src.filePath)) continue;
    const tokens = new Set<string>();
    for (const line of src.addedLines.slice(0, MAX_LINES_PER_FILE)) {
      for (const token of linkTokens(line)) tokens.add(token);
    }
    const ref: FileRef = { repoPath: src.repoPath, filePath: src.filePath };
    for (const token of tokens) {
      filesByToken.set(token, [...(filesByToken.get(token) ?? []), ref]);
    }
  }

  const candidates = new Map<string, FileLink[]>();
  for (const [token, refs] of filesByToken) {
    if (refs.length < 2 || refs.length > MAX_FILES_PER_TOKEN) continue;
    const repos = new Set(refs.map((r) => r.repoPath));
    if (repos.size < 2) continue;
    for (const ref of refs) {
      const others = refs.filter((r) => r.repoPath !== ref.repoPath);
      const key = fileKey(ref.repoPath, ref.filePath);
      candidates.set(key, [...(candidates.get(key) ?? []), { token, others }]);
    }
  }

  const result = new Map<string, FileLink[]>();
  for (const [key, links] of candidates) {
    const sorted = [...links].sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token));
    const kept: FileLink[] = [];
    for (const link of sorted) {
      const covered = kept.some((k) => k.token.includes(link.token) && sameRefs(k.others, link.others));
      if (!covered) kept.push(link);
      if (kept.length >= MAX_LINKS_PER_FILE) break;
    }
    result.set(key, kept);
  }
  return result;
}

/** 강조 표시용: `text`를 `token`과 일치하는 조각과 아닌 조각으로 나눈다. */
export function splitByToken(text: string, token: string): { text: string; match: boolean }[] {
  if (!token) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: token, match: true });
    from = at + token.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
