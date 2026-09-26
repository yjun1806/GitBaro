import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { TextInput, Textarea } from "@/components/ui/TextInput";

/** 요약 글자 수를 보이기 시작하는 길이와, 넘으면 경고하는 길이(git 관례의 한 줄 72자). */
export const SUMMARY_COUNTER_FROM = 60;
export const SUMMARY_LIMIT = 72;
/** 설명 칸이 자라는 최대 줄 수. 넘으면 칸 안에서 스크롤한다. */
const DESCRIPTION_MAX_LINES = 5;
const DESCRIPTION_LINE_PX = 18;

export interface CommitComposerProps {
  summary: string;
  description: string;
  onSummaryChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  /** 버튼 글에 넣을 브랜치(분리된 HEAD면 「HEAD」). */
  branchLabel: string;
  /** 어디에 누구로 커밋하는지(버튼 풍선 도움말). 예: 「feat/x에 커밋 · 메인 작업 트리」. */
  targetTitle: string;
  canCommit: boolean;
  isCommitting: boolean;
  onCommit: () => void;
}

/**
 * 작은 커밋 입력. 쉬는 상태에서는 한 줄 요약 칸(32px)과 「설명 추가」·「<브랜치>에 커밋」(28px) 한 줄뿐이다
 * (약 80px). 설명 칸은 「설명 추가」를 누를 때만 열리고, 내용에 맞춰 5줄까지 자란다. 요약 글자 수는
 * 한도 가까이에서만 보인다.
 */
export function CommitComposer({
  summary,
  description,
  onSummaryChange,
  onDescriptionChange,
  branchLabel,
  targetTitle,
  canCommit,
  isCommitting,
  onCommit,
}: CommitComposerProps) {
  const { t } = useTranslation();
  const [descOpen, setDescOpen] = useState(false);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const showDescription = descOpen || description.length > 0;
  const count = summary.length;
  const showCounter = count >= SUMMARY_COUNTER_FROM;
  const overLimit = count > SUMMARY_LIMIT;

  // 설명 칸은 내용에 맞춰 자란다(최대 5줄).
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = DESCRIPTION_LINE_PX * DESCRIPTION_MAX_LINES + 12;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [description, showDescription]);

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5 border-t border-border shrink-0" data-testid="commit-composer">
      <div className="relative">
        <TextInput
          placeholder={t("commit.summary")}
          aria-label={t("commit.summary")}
          value={summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          className={cn(showCounter && "pr-12")}
        />
        {showCounter && (
          <span
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] tabular-nums pointer-events-none",
              overLimit ? "text-warning" : "text-muted-foreground",
            )}
            title={overLimit ? t("commit.subjectTooLong", { max: SUMMARY_LIMIT }) : undefined}
            data-testid="summary-counter"
          >
            {count}/{SUMMARY_LIMIT}
          </span>
        )}
      </div>
      {showDescription && (
        <Textarea
          ref={descRef}
          autoFocus={descOpen && description.length === 0}
          placeholder={t("commit.description")}
          aria-label={t("commit.description")}
          rows={2}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onBlur={() => {
            if (description.length === 0) setDescOpen(false);
          }}
          className="resize-none"
        />
      )}
      <div className="flex items-center gap-2">
        {!showDescription && (
          <Button variant="ghost" size="sm" icon={<Plus className="w-3 h-3" aria-hidden="true" />} onClick={() => setDescOpen(true)}>
            {t("commit.addDescription")}
          </Button>
        )}
        <span className="flex-1" />
        <Button
          variant="primary"
          size="md"
          busy={isCommitting}
          disabled={!canCommit}
          title={targetTitle}
          data-testid="commit-target"
          className="max-w-full min-w-0"
          onClick={onCommit}
        >
          {isCommitting ? t("commit.committing") : <span className="truncate">{t("commit.submit", { branch: branchLabel })}</span>}
        </Button>
      </div>
    </div>
  );
}
