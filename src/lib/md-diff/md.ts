import MarkdownIt from "markdown-it";

/**
 * 문서 diff가 쓰는 **단 하나의** markdown-it 인스턴스.
 *
 * 파서가 둘이면 좌표계가 어긋나 유령 diff가 난다 — 계산(토큰 파싱)과 렌더(HTML)가
 * 반드시 같은 규칙을 봐야 한다. 그래서 모듈 싱글턴으로 구조적으로 못 박는다.
 *
 * **`html: true`는 살균을 전제로 한다.** 렌더 결과는 앱의 메인 컨텍스트에 들어가고, 그
 * 컨텍스트에는 Tauri `invoke()`가 노출돼 있다. 임의 저장소를 여는 앱이므로 README의 생
 * HTML은 신뢰할 수 없다.
 *
 * 그렇다고 이스케이프(`html: false`)로 막으면 안 된다. GitHub README는 가운데 정렬·배지·
 * 로고에 `<div align>`·`<img>`·`<br>`를 일상적으로 쓰는데, 그게 전부 화면에 생 태그
 * 글자로 쏟아진다(실제로 그런 화면이 나왔다). 안전하지만 읽을 수 없으면 뷰어가 아니다.
 *
 * 그래서 **위험한 것만 걷어낸다** — `paint.ts`의 `toElement`가 DOM에 넣기 **전에**
 * DOMPurify로 살균한다. 살균은 DOM이 필요해 여기서 못 하고, 이 파서의 출력은 반드시
 * 그 한 곳을 지나간다.
 */
export const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});
