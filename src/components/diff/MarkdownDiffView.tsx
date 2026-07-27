import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { paint, type PaintLabels } from "@/lib/md-diff/paint";
import { useDocDiff } from "@/lib/md-diff/use-doc-diff";
import "./md-diff.css";

interface MarkdownDiffViewProps {
  oldContent: string;
  newContent: string;
  /**
   * 실패 시 부모가 통합 보기로 물러설 수 있게 알린다 — 빈 화면을 남기지 않는다.
   * `reason`이 `"timeout"`이면 계산이 너무 오래 걸려 Worker를 끊은 경우다.
   */
  onError: (reason: string) => void;
}

/**
 * 렌더된 마크다운 위에 변경을 칠하는 보기.
 *
 * **DOM을 React가 아니라 `paint`가 만든다.** 하이라이트는 텍스트 노드를 쪼개 감싸고
 * 삭제 글자를 끼워 넣는 작업이라, React가 같은 서브트리를 소유하면 리렌더 때마다
 * 그 수술이 통째로 날아간다. 그래서 컨테이너 하나만 React가 잡고 안쪽은 통째로 맡긴다.
 */
export function MarkdownDiffView({ oldContent, newContent, onError }: MarkdownDiffViewProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const state = useDocDiff(oldContent, newContent);

  const labels = useMemo<PaintLabels>(
    () => ({
      // `count`를 쓰면 i18next가 복수형 키(`_one`/`_other`)를 찾는다 — 단순 치환으로 둔다.
      deletedBlocks: (blocks, chars) => t("mdDiff.deletedBlocks", { blocks, chars }),
      moved: t("mdDiff.moved"),
      tableStructureChanged: t("mdDiff.tableStructureChanged"),
      codeChanged: t("mdDiff.codeChanged"),
    }),
    [t],
  );

  useEffect(() => {
    if (state.status !== "ready" || !hostRef.current) return;
    paint(hostRef.current, state.model, labels);
  }, [state, labels]);

  useEffect(() => {
    if (state.status === "error") onError(state.error);
  }, [state, onError]);

  // 오류는 부모가 통합 보기로 전환하며 토스트로 설명한다 — 여기서 또 말하면 두 번 말하는 셈이다.
  if (state.status !== "ready") {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        {state.status === "error" ? null : (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("mdDiff.rendering")}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div ref={hostRef} className="md-diff" />
    </div>
  );
}
