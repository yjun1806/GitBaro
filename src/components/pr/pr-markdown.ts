import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/**
 * PR 본문·코멘트용 markdown-it. 문서 diff의 파서(`lib/md-diff/md.ts`)와 따로 둔다 — 그쪽은 좌표계를
 * 맞추려고 하나만 쓰는 인스턴스이고, 코멘트는 GitHub처럼 줄바꿈을 그대로 줄바꿈으로 보인다(`breaks`).
 *
 * GitHub 본문에는 `<details>`·`<img>`·`<br>` 같은 생 HTML이 흔해 `html: true`로 둔다. 대신 결과는
 * 반드시 `renderPrMarkdown`의 살균을 지나간다. 앱의 메인 컨텍스트에는 Tauri `invoke()`가 있고,
 * PR 본문은 누구나 쓸 수 있는 글이다.
 */
const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false });

/**
 * 살균 설정. 문서 diff(`lib/md-diff/paint.ts`)와 같은 이유로 `style`·`class`·`id`와 폼 요소를 걷어낸다
 * (앱 화면을 덮거나 흉내 내는 마크업, 실제로 동작하는 입력창). 주소는 http(s)·mailto·같은 문서 안
 * 앵커만 남긴다 — `javascript:`·`data:`·앱 안 상대 경로로 가는 링크를 막는다. `<img>`의 `data:` 이미지는
 * DOMPurify가 따로 허용한다(그림으로만 그려지고 코드를 실행하지 않는다).
 */
const SANITIZE = {
  FORBID_ATTR: ["style", "class", "id"],
  FORBID_TAGS: ["form", "input", "button", "select", "textarea", "iframe", "object", "embed"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

/** 마크다운 → 살균한 HTML. 결과만 DOM에 넣는다. */
export function renderPrMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), SANITIZE);
}
