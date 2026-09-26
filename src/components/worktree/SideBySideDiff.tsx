import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useFileDiff } from "@/api/queries";
import { Dialog } from "@/components/ui/Dialog";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { cn } from "@/lib/utils";
import { overlapWorktreeName, WorktreeTag, type OverlapSibling } from "./OverlapBadge";
import { LoadingState } from "@/components/ui/LoadingState";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { FLOATING_SURFACE } from "@/components/ui/layers";

export interface SideBySideSide {
  path: string;
  branch: string | null;
  staged: boolean;
}

export interface SideBySideDiffProps {
  /** 지금 보던 워크트리(왼쪽)에서의 경로. */
  filePath: string;
  /**
   * 다른 워크트리(오른쪽)에서의 경로. 이름을 바꾼 파일은 겹침이 옛 경로로만 맞을 수 있어
   * `filePath`와 다를 수 있다(`OverlapBadge.tsx`의 `matchedPathOf`). 생략하면 `filePath`와 같다.
   */
  theirFilePath?: string;
  /** 지금 보던 워크트리(왼쪽). */
  mine: SideBySideSide;
  /** 같은 파일을 고치는 다른 워크트리들. 하나를 골라 오른쪽에 둔다. */
  siblings: readonly OverlapSibling[];
  onClose: () => void;
}

/** 한 워크트리의 그 파일 diff. 기존 `DiffViewer`를 그대로 쓴다. */
function DiffColumn({ side, filePath, label }: { side: SideBySideSide; filePath: string; label: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useFileDiff(side.path, filePath, side.staged);
  return (
    <section aria-label={label} className="flex flex-col flex-1 min-w-0 min-h-0">
      <Card className="flex-1 min-h-0">
        <div className="flex items-center gap-2 h-8 px-3 shrink-0 border-b border-(--line)">
          <WorktreeTag name={overlapWorktreeName(side)} path={side.path} />
          <span className="truncate text-[11.5px] text-muted-foreground" title={side.path}>
            {side.path}
          </span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {isError ? (
            <div className="flex-1 flex items-center justify-center text-[12.5px] text-danger">{t("diff.failedToLoad")}</div>
          ) : isLoading && !data ? (
            <LoadingState label={t("diff.loadingDiff")} />
          ) : (
            <DiffViewer diff={data ?? null} staged={side.staged} />
          )}
        </div>
      </Card>
    </section>
  );
}

/**
 * 두 워크트리가 함께 고치는 파일을 나란히 본다(시안 D5 「두 워크트리 나란히 보기」).
 * 왼쪽은 지금 보던 워크트리, 오른쪽은 같은 파일을 고치는 다른 워크트리다. 여럿이면 위에서 고른다.
 */
export function SideBySideDiff({ filePath, theirFilePath, mine, siblings, onClose }: SideBySideDiffProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [pick, setPick] = useState(0);
  const other = siblings[Math.min(pick, siblings.length - 1)];
  const otherPath = theirFilePath ?? filePath;
  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      className={cn("flex flex-col w-[94vw] h-[88vh] p-(--g) gap-(--g) rounded-(--radius-panel)", FLOATING_SURFACE)}
    >
      <div className="flex items-center gap-2 shrink-0 px-1">
        <h2 id={titleId} className="text-[14px] font-semibold text-foreground">
          ⧉ {t("overlap.sideBySideTitle")}
        </h2>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground" title={filePath}>
          {filePath}
        </span>
        <span className="flex-1" />
        {siblings.length > 1 && (
          <Segmented
            size="sm"
            ariaLabel={t("overlap.pickWorktree")}
            value={other?.path ?? ""}
            onChange={(path) => {
              const idx = siblings.findIndex((s) => s.path === path);
              if (idx >= 0) setPick(idx);
            }}
            options={siblings.map((s) => ({ value: s.path, label: overlapWorktreeName(s) }))}
          />
        )}
        <Button iconOnly size="md" variant="ghost" onClick={onClose} aria-label={t("overlap.close")} title={t("overlap.close")}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex flex-1 min-h-0 gap-(--g)">
        <DiffColumn side={mine} filePath={filePath} label={t("overlap.thisWorktree")} />
        {other && <DiffColumn key={other.path} side={other} filePath={otherPath} label={t("overlap.otherWorktree")} />}
      </div>
    </Dialog>
  );
}
