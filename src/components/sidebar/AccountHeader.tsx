import { useState } from "react";
import { Building2, FolderPlus, Globe, HardDrive, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SortMode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { SortMenu } from "./SortMenu";
import { TreeRowFrame } from "./TreeRowFrame";
import { WorkspaceNameDialog } from "./WorkspaceDialogs";

interface AccountHeaderProps {
  label: string;
  /** 비교·저장용 계정 키(소문자). 정렬과 새 워크스페이스가 이 계정에 붙는다. */
  accountKey: string;
  /** 계정 안 저장소 수(워크스페이스 안 저장소와 조용한 저장소 포함) */
  repoCount: number;
  ownerType?: "User" | "Organization";
  sortMode: SortMode;
  /**
   * 정렬 메뉴와 새 워크스페이스 버튼을 보일지. 계정을 아직 모르는 임시 그룹(「Other」)에서는
   * 끈다. 그 키에 워크스페이스나 정렬을 저장하면 계정을 불러온 뒤 어느 계정에도 속하지 않는다.
   */
  showActions: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function accountIcon(label: string, ownerType?: "User" | "Organization") {
  if (label === "Local") return HardDrive;
  if (ownerType === "Organization") return Building2;
  if (ownerType === "User") return User;
  return Globe;
}

/**
 * 계정 머리글: ▾/▸, 개인·조직 아이콘, 계정 이름(대문자), 저장소 수, 정렬 메뉴(D2 시안).
 * 끝의 새 워크스페이스 버튼은 시안에 없다. README는 제안과 끌어 놓기로만 만든다고 적지만,
 * 끌어 놓을 워크스페이스가 먼저 있어야 해서 직접 만드는 입구로 더했다.
 */
export function AccountHeader({
  label,
  accountKey,
  repoCount,
  ownerType,
  sortMode,
  showActions,
  expanded,
  onToggle,
}: AccountHeaderProps) {
  const { t } = useTranslation();
  const setSortMode = useWorkspaceStore((s) => s.setSortMode);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [creating, setCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const Icon = accountIcon(label, ownerType);
  return (
    <>
      <TreeRowFrame
        level={1}
        depth={0}
        label={label}
        expanded={expanded}
        onToggle={onToggle}
        className="mt-2 gap-1.5 group"
      >
        <Icon className="w-3 h-3 shrink-0 text-[var(--faint)]" aria-hidden="true" />
        {/* 계정 이름 + 저장소 수가 너비를 먼저 갖는다 — 정렬·워크스페이스 버튼은 hover/focus/열림 때만
            나타나 이름을 밀어내지 않는다(W-Top-T4: 「MONDAY…」로 잘리던 문제). */}
        <span
          title={label}
          className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-muted-foreground truncate min-w-0"
        >
          {label}
        </span>
        <span className="text-[10.5px] text-[var(--faint)] tabular-nums shrink-0">{repoCount}</span>
        <span className="flex-1" />
        {showActions && (
          <span
            className={cn(
              "flex items-center gap-1 shrink-0 transition-opacity",
              sortOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <SortMenu mode={sortMode} onChange={(mode) => setSortMode(accountKey, mode)} onOpenChange={setSortOpen} />
            <button
              type="button"
              title={t("workspace.create")}
              aria-label={t("workspace.create")}
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-5 h-5 shrink-0 flex items-center justify-center rounded-[var(--radius-chip)] text-[var(--faint)] hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <FolderPlus className="w-3 h-3" aria-hidden="true" />
            </button>
          </span>
        )}
      </TreeRowFrame>
      {/* 창은 행 밖에 둔다. 행 안에 두면 창 안의 누르기가 React 트리를 따라 행의 접기로 올라간다. */}
      {creating && (
        <WorkspaceNameDialog
          mode="create"
          subject={label}
          onSubmit={(name) => createWorkspace(name, accountKey)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
