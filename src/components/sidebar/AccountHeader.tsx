import { Building2, Globe, HardDrive, User } from "lucide-react";
import { TreeRowFrame } from "./TreeRowFrame";

interface AccountHeaderProps {
  label: string;
  /** 계정 안 저장소 수(워크스페이스 안 저장소와 조용한 저장소 포함) */
  repoCount: number;
  ownerType?: "User" | "Organization";
  expanded: boolean;
  onToggle: () => void;
}

function accountIcon(label: string, ownerType?: "User" | "Organization") {
  if (label === "Local") return HardDrive;
  if (ownerType === "Organization") return Building2;
  if (ownerType === "User") return User;
  return Globe;
}

/** 계정 머리글: ▾/▸, 개인·조직 아이콘, 계정 이름(대문자), 저장소 수. */
export function AccountHeader({ label, repoCount, ownerType, expanded, onToggle }: AccountHeaderProps) {
  const Icon = accountIcon(label, ownerType);
  return (
    <TreeRowFrame
      level={1}
      depth={0}
      label={label}
      expanded={expanded}
      onToggle={onToggle}
      className="mt-2 gap-1.5"
    >
      <Icon className="w-3 h-3 shrink-0 text-[var(--faint)]" aria-hidden="true" />
      <span className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-muted-foreground truncate">
        {label}
      </span>
      <span className="text-[10.5px] text-[var(--faint)] tabular-nums">{repoCount}</span>
    </TreeRowFrame>
  );
}
