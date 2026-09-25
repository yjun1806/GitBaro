import { ChevronRight } from "lucide-react";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { useRepositoryStore } from "@/stores/repository";

/**
 * 머리 줄 경로의 첫 칸: 지금 연 저장소(아바타 + 이름). 누르는 버튼이 아니라 이름표다.
 * 폴더(워크트리)와 브랜치는 뒤따르는 칸이 각자의 패널을 연다.
 */
export function RepoCrumb() {
  // 워크트리를 보는 중에도 activeRepo는 소유 저장소다.
  const repo = useRepositoryStore((s) => s.activeRepo);
  if (!repo) return null;
  const avatar = avatarColor(repo.path);
  return (
    <span className="flex items-center gap-1.5 h-7 pl-1 pr-0.5 min-w-0 shrink-0" title={repo.path}>
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-[5px] shrink-0 flex items-center justify-center text-[10.5px] font-extrabold"
        style={{ backgroundColor: avatar.background, color: avatar.foreground }}
      >
        {avatarInitial(repo.name)}
      </span>
      <span className="text-[13px] font-bold text-(--fg) truncate max-w-[160px]">{repo.name}</span>
    </span>
  );
}

/** 경로 칸 사이의 구분 표시(›). 저장소 › 폴더 › 브랜치 순서를 보인다. */
export function CrumbSeparator() {
  return <ChevronRight aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-(--faint)" />;
}
