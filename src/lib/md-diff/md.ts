import MarkdownIt from "markdown-it";

/**
 * 문서 diff가 쓰는 **단 하나의** markdown-it 인스턴스.
 *
 * 파서가 둘이면 좌표계가 어긋나 유령 diff가 난다 — 계산(토큰 파싱)과 렌더(HTML)가
 * 반드시 같은 규칙을 봐야 한다. 그래서 모듈 싱글턴으로 구조적으로 못 박는다.
 *
 * **`html: false`는 보안 요구사항이다.** 렌더 결과는 앱의 메인 컨텍스트에 그대로 들어가고,
 * 그 컨텍스트에는 Tauri `invoke()`가 노출돼 있다. 임의 저장소를 클론해 여는 앱에서
 * README의 생 HTML을 실행 가능한 마크업으로 들여보내면 저장소 하나가 앱 전체를 장악한다.
 * markdown-it은 `html: false`일 때 생 HTML을 이스케이프하고 링크 프로토콜도 검증한다.
 */
export const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});
