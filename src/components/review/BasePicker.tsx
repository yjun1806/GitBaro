import { useTranslation } from "react-i18next";
import { useBranches, useWorktrees } from "@/api/queries";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { trimTrailingSlash } from "@/lib/utils";

export interface BasePickerProps {
  /** 저장소(워크트리) 경로. */
  path: string;
  /** 고른 기준. null이면 기본 브랜치. */
  value: string | null;
  /** 기본 브랜치 이름. 모르면 null. */
  defaultBranch: string | null;
  /** 목록에서 뺄 브랜치(비교 대상 자신). */
  exclude: string | null;
  onChange: (base: string | null) => void;
}

/** 이 워크트리가 갈라져 나온 브랜치(워크트리 기반). 모르거나 메인 워크트리면 null. */
export function worktreeBaseOf(path: string, worktrees: readonly WorktreeInfo[]): string | null {
  const key = trimTrailingSlash(path);
  return worktrees.find((w) => trimTrailingSlash(w.path) === key)?.base?.name ?? null;
}

/** 기준으로 고를 수 있는 브랜치: 로컬·원격(`origin/HEAD` 같은 별칭과 비교 대상 자신은 뺀다). */
export function baseCandidates(branches: readonly BranchInfo[], exclude: string | null) {
  const usable = branches.filter((b) => b.name !== exclude && !b.name.endsWith("/HEAD"));
  return { local: usable.filter((b) => !b.isRemote), remote: usable.filter((b) => b.isRemote) };
}

/**
 * 「main 대비 변경」의 비교 기준 선택. 기본은 기본 브랜치이고, 워크트리 기반 브랜치(알 때)와
 * 로컬·원격 브랜치를 고를 수 있다.
 */
export function BasePicker({ path, value, defaultBranch, exclude, onChange }: BasePickerProps) {
  const { t } = useTranslation();
  const { data: branches = [] } = useBranches(path);
  const { data: worktrees = [] } = useWorktrees(path);
  const worktreeBase = worktreeBaseOf(path, worktrees);
  const { local, remote } = baseCandidates(branches, exclude);
  const known = new Set(branches.map((b) => b.name));
  return (
    <label className="flex items-center gap-1 shrink-0 text-[11px] text-muted-foreground">
      <span>{t("filesByRepo.baseLabel")}</span>
      <select
        aria-label={t("filesByRepo.basePicker")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-6 max-w-[180px] px-1.5 rounded-(--radius-chip) bg-(--chip) font-mono text-[11px] text-(--fg2) hover:bg-accent"
      >
        <option value="">{t("filesByRepo.baseDefault", { branch: defaultBranch ?? "main" })}</option>
        {worktreeBase && worktreeBase !== defaultBranch && (
          <option value={worktreeBase}>{t("filesByRepo.baseWorktree", { branch: worktreeBase })}</option>
        )}
        {/* 목록에 없는 기준(지워진 브랜치 등)도 고른 값으로 보이게 둔다. */}
        {value && !known.has(value) && value !== worktreeBase && <option value={value}>{value}</option>}
        {local.length > 0 && (
          <optgroup label={t("branchPanel.local")}>
            {local.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
        {remote.length > 0 && (
          <optgroup label={t("branchPanel.remote")}>
            {remote.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
