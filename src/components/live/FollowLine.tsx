import { useTranslation } from "react-i18next";
import { splitFilePath } from "@/components/layout/maximized-files";
import { Dot } from "@/components/ui/marks";
import type { FollowMode } from "@/stores/follow";

export interface FollowLineProps {
  mode: FollowMode;
  /** 고정된 동안 보여 주는 파일. 따라가는 중이면 쓰지 않는다. */
  pinnedFile: string | null;
  /** 고정된 줄을 눌렀을 때 다시 최신 변경을 따라간다. */
  onResume: () => void;
  /** 「눈여겨볼 것」 한 줄(`followNote`). 알릴 게 없으면 null — 오른쪽은 비운다. */
  note: string | null;
}

/**
 * 따라가기 중일 때만 diff 위에 얹는 줄(D49). 왼쪽은 지금 최신 변경을 자동으로 따라가는 중인지,
 * 다른 파일을 골라 고정됐는지. 오른쪽은 그 파일에 있었던 사실 하나(`followNote`). 확인 표시·진행률·
 * 봤음은 없다. 커밋을 보거나 따라가기가 꺼지면 이 줄 자체를 그리지 않는다(부르는 쪽의 몫).
 */
export function FollowLine({ mode, pinnedFile, onResume, note }: FollowLineProps) {
  const { t } = useTranslation();
  const following = mode === "following";
  return (
    <div
      data-testid="follow-line"
      className="flex items-center gap-2.5 shrink-0 px-3 py-1.5 border-b border-(--line) bg-(--live-faint) text-[11.5px] text-(--fg2) min-w-0"
    >
      {following ? (
        <span className="flex items-center gap-1.5 shrink-0 font-semibold text-(--live)">
          <Dot on breathe />
          {t("live.followLineFollowing")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="flex items-center gap-1 shrink-0 font-semibold text-primary hover:underline"
        >
          {t("live.followLinePinned", { file: pinnedFile ? splitFilePath(pinnedFile).name : "" })}
        </button>
      )}
      {note && (
        <span className="flex-1 min-w-0 truncate">
          <b className="font-semibold text-foreground mr-1.5">{t("live.followLineNoteLabel")}</b>
          {note}
        </span>
      )}
    </div>
  );
}
