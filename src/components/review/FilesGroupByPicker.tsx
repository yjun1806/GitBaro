import { useTranslation } from "react-i18next";
import type { FilesGroupBy } from "./files-view";

/** 「저장소별 · 폴더별」 고르기. 탭 머리 오른쪽에 둔다(D7). */
export interface FilesGroupByPickerProps {
  value: FilesGroupBy;
  onChange: (value: FilesGroupBy) => void;
}

export function FilesGroupByPicker({ value, onChange }: FilesGroupByPickerProps) {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t("filesByRepo.groupBy")}
      value={value}
      onChange={(e) => onChange(e.target.value === "folder" ? "folder" : "repo")}
      className="shrink-0 h-6 px-1.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent"
    >
      <option value="repo">{t("filesByRepo.groupByRepo")}</option>
      <option value="folder">{t("filesByRepo.groupByFolder")}</option>
    </select>
  );
}
