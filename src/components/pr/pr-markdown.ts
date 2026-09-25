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
 *
 * `<style>`은 속성이 아니라 요소라 `FORBID_ATTR`로는 걸리지 않는다. 본문 중간이나 `<svg>` 안에 두면
 * 앱 전체의 스타일을 바꾸므로 요소째 막는다. `<svg>`·`<math>`는 그 안에서 규칙이 달라지는 별도
 * 네임스페이스라 통째로 막고, 문서 머리 요소(`link`·`meta`·`base`)도 막는다.
 */
const SANITIZE = {
  FORBID_ATTR: ["style", "class", "id"],
  FORBID_TAGS: [
    "style",
    "svg",
    "math",
    "link",
    "meta",
    "base",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "iframe",
    "object",
    "embed",
  ],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

/**
 * 앱이 그릴 수 있는 그림인가. `src-tauri/tauri.conf.json`의 CSP `img-src`와 맞춘다(`data:`,
 * `https://*.githubusercontent.com`). CSP를 넓히지 않는다 — PR 본문의 `github.com/user-attachments`
 * 그림은 어차피 비공개 저장소면 GitHub 로그인 쿠키가 있어야 보인다.
 */
function isLoadableImage(src: string): boolean {
  if (/^data:/i.test(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

/** 앱이 그릴 수 없는 그림 대신 둘 링크. `href`는 그 글의 GitHub 주소(PR·코멘트). */
export interface BlockedImageLink {
  href: string;
  label: string;
}

/** 그릴 수 없는 `<img>`를 GitHub로 가는 작은 링크로 바꾼다. 살균한 HTML에만 쓴다. */
function replaceBlockedImages(html: string, link: BlockedImageLink): string {
  if (!html.includes("<img")) return html;
  // <template>의 내용은 문서에 붙지 않아 그림을 불러오지 않는다.
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const img of tpl.content.querySelectorAll("img")) {
    if (isLoadableImage(img.getAttribute("src") ?? "")) continue;
    const a = document.createElement("a");
    const src = img.getAttribute("src") ?? "";
    a.href = /^https:/i.test(link.href) ? link.href : src;
    a.textContent = link.label;
    const alt = img.getAttribute("alt");
    if (alt) a.title = alt;
    img.replaceWith(a);
  }
  return tpl.innerHTML;
}

/**
 * 마크다운 → 살균한 HTML. 결과만 DOM에 넣는다. `blockedImage`를 주면 앱이 그릴 수 없는 그림을
 * 그 링크로 바꾼다.
 */
export function renderPrMarkdown(source: string, blockedImage?: BlockedImageLink): string {
  const html = DOMPurify.sanitize(md.render(source), SANITIZE);
  return blockedImage ? replaceBlockedImages(html, blockedImage) : html;
}
