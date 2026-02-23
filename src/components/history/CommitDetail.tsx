import { useState, type ReactNode } from "react";
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handleFileClick = (path: string) => {
    setSelectedPath(path);
    onSelectFile?.(path);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Commit metadata */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <GitCommit className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">
              {commit.summary}
            </p>
            {commit.message !== commit.summary && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                {commit.message.slice(commit.summary.length).trim()}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <MetaRow icon={<User className="w-3.5 h-3.5" />} label="Author">
            {commit.author.name} &lt;{commit.author.email}&gt;
          </MetaRow>
          <MetaRow icon={<Clock className="w-3.5 h-3.5" />} label="Date">
            {formatDate(commit.timestamp)}
          </MetaRow>
          <MetaRow icon={<GitFork className="w-3.5 h-3.5" />} label="Commit">
            <span className="font-mono">{commit.id}</span>
          </MetaRow>
          {commit.parentIds.length > 0 && (
            <MetaRow icon={<GitFork className="w-3.5 h-3.5" />} label="Parents">
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
        <div className="w-52 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
          <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
            Changed Files ({changedFiles.length})
          </p>
          {changedFiles.map((f) => (
            <button
              key={f.path}
              onClick={() => handleFileClick(f.path)}
              className={`w-full px-3 py-1.5 text-xs text-left truncate transition-colors ${
                selectedPath === f.path
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
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
      <span className="text-gray-400 mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 min-w-0 break-all">
        {children}
      </span>
    </div>
  );
}
