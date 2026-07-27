/**
 * 문서 diff 노브 — 전부 "읽히는 화면"을 지키기 위한 상한이다.
 *
 * 값은 muxa(같은 저자의 macOS 터미널 앱)에서 실사용으로 조정된 것을 그대로 가져왔다.
 * 새로 튜닝하지 말고, 바꿔야 하면 골든 테스트를 먼저 고쳐라.
 */
export interface DocDiffOptions {
  /** 블록 유사 매칭 임계값. 이 아래면 "닮은 블록"이 아니라 삭제+삽입이다. */
  blockSimilarity: number;
  /** 어절 쌍을 문자 단위로 세분할 임계값. "문단을/문단이"=0.67 통과, "고양이/강아지"=0.00 탈락. */
  wordSimilarity: number;
  /** 문자 단계 과분절 상한 — cleanup 후에도 조각이 이만큼 많으면 통째 교체로 승격. */
  maxFragments: number;
  /** 공통 조각의 평균 길이 하한 — 이보다 잘면 읽히지 않는다. */
  minCommonRun: number;
  /** 인접 변경 스팬 병합 거리(문자). "3글자 고쳤는데 하이라이트 다섯 조각"을 막는다. */
  mergeDistance: number;
  /** 이동 판정 최소 길이 — 짧은 블록의 우연 일치를 배제한다. */
  moveMinChars: number;
  /** 어절 단계 과분절 상한. 넘으면 "단어 수프"가 되므로 문단을 통째 교체로 보여준다. */
  maxWordFragments: number;
  /** 변경 비율 상한 — 이만큼 넘게 바뀌었으면 "고친 것"이 아니라 "다시 쓴 것"이다. */
  maxChangeRatio: number;
  /** 비율 판정을 적용할 최소 길이. 짧은 문장은 단어 하나만 바꿔도 비율이 쉽게 넘는다. */
  ratioMinChars: number;
}

export const DEFAULT_OPTIONS: DocDiffOptions = {
  blockSimilarity: 0.5,
  wordSimilarity: 0.5,
  maxFragments: 3,
  minCommonRun: 2,
  mergeDistance: 2,
  moveMinChars: 20,
  maxWordFragments: 8,
  maxChangeRatio: 0.5,
  ratioMinChars: 80,
};
