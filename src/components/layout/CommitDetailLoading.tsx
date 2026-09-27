import { LoadingState } from "@/components/ui/LoadingState";
import { useHoldDiffFileOpen } from "./pane-state";

/** 커밋 상세를 읽는 중. 앞 커밋에서 파일을 열어 둔 2단계였으면 그대로 둔다(`useHoldDiffFileOpen`). */
export function CommitDetailLoading({ label }: { label: string }) {
  useHoldDiffFileOpen();
  return <LoadingState label={label} />;
}
