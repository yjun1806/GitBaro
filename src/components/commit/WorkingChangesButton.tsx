import { useTranslation } from "react-i18next";
import { FileDiff } from "lucide-react";
import { useOpenWorkingChanges } from "./useOpenWorkingChanges";

/**
 * 지금 연 워크트리의 WIP 행 끝의 「작업 중인 변경」. 스테이징 목록과 커밋 입력을 열고 파일 목록에
 * 포커스를 둔다. 이동만 한다 — 이름에 「커밋」 동사를 쓰지 않는 이유다. 파일 수는 같은 행이 말한다.
 */
export function WorkingChangesButton() {
  const { t } = useTranslation();
  const open = useOpenWorkingChanges();
  return (
    <button
      type="button"
      onClick={open}
      data-working-changes=""
      className="inline-flex items-center gap-1 shrink-0 h-[22px] px-2 rounded-(--radius-chip) text-[11px] font-semibold bg-(--chip) text-(--fg2) hover:bg-accent transition-colors"
    >
      <FileDiff className="w-3 h-3" aria-hidden="true" />
      {t("commit.workingChanges")}
    </button>
  );
}
