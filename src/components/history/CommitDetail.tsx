import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GitCommit, User, Clock, GitFork } from "lucide-react";
import type { CommitInfo, DiffOutput, FileStatus } from "@/types";
import { DiffViewer } from "@/components/diff/DiffViewer";

interface CommitDetailProps {
  commit: CommitInfo;
  changedFiles?: Array<{ path: string; status: FileStatus }>;
  selectedFileDiff?: DiffOutput | null;
  onSelectFile?: (path: string) => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function CommitDetail({
  commit,
  changedFiles = [],
  selectedFileDiff,
  onSelectFile,
}: CommitDetailProps) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handleFileClick = (path: string) => {
    setSelectedPath(path);
    onSelectFile?.(path);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Commit metadata */}
      <div className="px-5 py-4 border-b border-border flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <GitCommit className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground leading-snug">
              {commit.summary}
            </p>
            {commit.message !== commit.summary && (
              <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                {commit.message.slice(commit.summary.length).trim()}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <MetaRow icon={<User className="w-3.5 h-3.5" />} label={t("history.author")}>
            {commit.author.name} &lt;{commit.author.email}&gt;
          </MetaRow>
          <MetaRow icon={<Clock className="w-3.5 h-3.5" />} label={t("history.date")}>
            {formatDate(commit.timestamp)}
          </MetaRow>
          <MetaRow icon={<GitFork className="w-3.5 h-3.5" />} label={t("history.commitHash")}>
            <span className="font-mono">{commit.id}</span>
          </MetaRow>
          {commit.parentIds.length > 0 && (
            <MetaRow icon={<GitFork className="w-3.5 h-3.5" />} label={t("history.parents")}>
              {commit.parentIds.map((id) => (
                <span key={id} className="font-mono mr-2">
                  {id.slice(0, 7)}
                </span>
              ))}
            </MetaRow>
          )}
        </div>
      </div>

      {/* Changed files */}
      <div className="flex h-0 flex-1">
        {/* File list */}
        <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
          <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
            {t("history.changedFiles")} ({changedFiles.length})
          </p>
          {changedFiles.map((f) => (
            <button
              key={f.path}
              onClick={() => handleFileClick(f.path)}
              className={`w-full px-3 py-1.5 text-xs text-left truncate transition-colors ${
                selectedPath === f.path
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              {f.path}
            </button>
          ))}
        </div>

        {/* Diff viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <DiffViewer
            diff={selectedFileDiff ?? null}
            status={
              changedFiles.find((f) => f.path === selectedPath)?.status ?? "modified"
            }
          />
        </div>
      </div>
    </div>
  );
}

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}

function MetaRow({ icon, label, children }: MetaRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-12 shrink-0">{label}</span>
      <span className="text-xs text-foreground flex-1 min-w-0 break-all">
        {children}
      </span>
    </div>
  );
}
