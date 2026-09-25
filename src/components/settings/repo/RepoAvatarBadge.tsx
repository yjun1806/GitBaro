import type { AvatarColor } from "@/lib/avatar-color";
import { avatarInitial } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";

interface RepoAvatarBadgeProps {
  name: string;
  color: AvatarColor;
  className?: string;
}

/** 저장소 이니셜 아바타(설정 창 머리와 색 고르기 미리보기). */
export function RepoAvatarBadge({ name, color, className }: RepoAvatarBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex items-center justify-center shrink-0 rounded-[7px] font-extrabold", className)}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {avatarInitial(name)}
    </span>
  );
}
