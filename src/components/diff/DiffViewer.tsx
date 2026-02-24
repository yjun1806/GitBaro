import { Fragment, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { DiffOutput, FileStatus } from "@/types";
import { DiffHeader } from "./DiffHeader";

interface DiffViewerProps {
  diff: DiffOutput | null;
  status?: FileStatus;
}

export function DiffViewer({ diff, status = "modified" }: DiffViewerProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const stats = useMemo(() => {
    if (!diff) return { added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.lineType === "add") added++;
        else if (line.lineType === "delete") removed++;
      }
    }
    return { added, removed };
  }, [diff]);

  const toggleView = () =>
    setViewMode((v) => (v === "unified" ? "split" : "unified"));

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("diff.noSelection")}
      </div>
    );
  }

  if (diff.binary) {
    return (
      <div className="flex-1 flex flex-col">
        <DiffHeader
          filePath={diff.filePath}
          status={status}
          addedLines={0}
          removedLines={0}
          viewMode={viewMode}
          onToggleView={toggleView}
        />
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("diff.binary")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <DiffHeader
        filePath={diff.filePath}
        status={status}
        addedLines={stats.added}
        removedLines={stats.removed}
        viewMode={viewMode}
        onToggleView={toggleView}
      />

      <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
        {viewMode === "unified" ? (
          <UnifiedView diff={diff} />
        ) : (
          <SplitView diff={diff} />
        )}
      </div>
    </div>
  );
}

function UnifiedView({ diff }: { diff: DiffOutput }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {diff.hunks.map((hunk, hi) => (
          <Fragment key={`hunk-${hi}`}>
            <tr className="bg-diff-hunk">
              <td className="px-2 py-0.5 text-diff-hunk-fg select-none w-10 text-right border-r border-diff-hunk/30">
                ...
              </td>
              <td className="px-2 py-0.5 text-diff-hunk-fg select-none w-10 text-right border-r border-diff-hunk/30">
                ...
              </td>
              <td className="px-4 py-0.5 text-diff-hunk-fg font-normal">
                {hunk.header}
              </td>
            </tr>
            {hunk.lines.map((line, li) => (
              <tr
                key={`line-${hi}-${li}`}
                className={clsx(
                  line.lineType === "add" && "bg-diff-add",
                  line.lineType === "delete" && "bg-diff-del"
                )}
              >
                <td className="px-2 py-0 text-muted-foreground select-none w-10 text-right border-r border-border">
                  {line.oldLineNo ?? ""}
                </td>
                <td className="px-2 py-0 text-muted-foreground select-none w-10 text-right border-r border-border">
                  {line.newLineNo ?? ""}
                </td>
                <td
                  className={clsx(
                    "px-4 py-0 whitespace-pre",
                    line.lineType === "add" && "text-diff-add-fg",
                    line.lineType === "delete" && "text-diff-del-fg",
                    line.lineType === "context" && "text-foreground"
                  )}
                >
                  <span className="mr-2 select-none text-muted-foreground/50">
                    {line.lineType === "add" ? "+" : line.lineType === "delete" ? "-" : " "}
                  </span>
                  {line.content}
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function SplitView({ diff }: { diff: DiffOutput }) {
  return (
    <div className="flex">
      {/* Left (old) */}
      <table className="w-1/2 border-collapse border-r border-border">
        <tbody>
          {diff.hunks.map((hunk, hi) => (
            <Fragment key={`left-hunk-${hi}`}>
              <tr className="bg-diff-hunk">
                <td className="px-2 py-0.5 text-diff-hunk-fg select-none w-10 text-right border-r border-diff-hunk/30">
                  ...
                </td>
                <td className="px-4 py-0.5 text-diff-hunk-fg">
                  {hunk.header}
                </td>
              </tr>
              {hunk.lines
                .filter((l) => l.lineType !== "add")
                .map((line, li) => (
                  <tr
                    key={`left-line-${hi}-${li}`}
                    className={
                      line.lineType === "delete" ? "bg-diff-del" : ""
                    }
                  >
                    <td className="px-2 py-0 text-muted-foreground select-none w-10 text-right border-r border-border">
                      {line.oldLineNo ?? ""}
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-0 whitespace-pre",
                        line.lineType === "delete"
                          ? "text-diff-del-fg"
                          : "text-foreground"
                      )}
                    >
                      {line.content}
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      {/* Right (new) */}
      <table className="w-1/2 border-collapse">
        <tbody>
          {diff.hunks.map((hunk, hi) => (
            <Fragment key={`right-hunk-${hi}`}>
              <tr className="bg-diff-hunk">
                <td className="px-2 py-0.5 text-diff-hunk-fg select-none w-10 text-right border-r border-diff-hunk/30">
                  ...
                </td>
                <td className="px-4 py-0.5 text-diff-hunk-fg">
                  {hunk.header}
                </td>
              </tr>
              {hunk.lines
                .filter((l) => l.lineType !== "delete")
                .map((line, li) => (
                  <tr
                    key={`right-line-${hi}-${li}`}
                    className={
                      line.lineType === "add" ? "bg-diff-add" : ""
                    }
                  >
                    <td className="px-2 py-0 text-muted-foreground select-none w-10 text-right border-r border-border">
                      {line.newLineNo ?? ""}
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-0 whitespace-pre",
                        line.lineType === "add"
                          ? "text-diff-add-fg"
                          : "text-foreground"
                      )}
                    >
                      {line.content}
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
