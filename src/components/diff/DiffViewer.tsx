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
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
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
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
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
            <tr className="bg-blue-50 dark:bg-blue-950/30">
              <td className="px-2 py-0.5 text-blue-400 select-none w-10 text-right border-r border-blue-100 dark:border-blue-900">
                ...
              </td>
              <td className="px-2 py-0.5 text-blue-400 select-none w-10 text-right border-r border-blue-100 dark:border-blue-900">
                ...
              </td>
              <td className="px-4 py-0.5 text-blue-500 dark:text-blue-400 font-normal">
                {hunk.header}
              </td>
            </tr>
            {hunk.lines.map((line, li) => (
              <tr
                key={`line-${hi}-${li}`}
                className={clsx(
                  line.lineType === "add" && "bg-green-50 dark:bg-green-950/30",
                  line.lineType === "delete" && "bg-red-50 dark:bg-red-950/30"
                )}
              >
                <td className="px-2 py-0 text-gray-400 select-none w-10 text-right border-r border-gray-100 dark:border-gray-800">
                  {line.oldLineNo ?? ""}
                </td>
                <td className="px-2 py-0 text-gray-400 select-none w-10 text-right border-r border-gray-100 dark:border-gray-800">
                  {line.newLineNo ?? ""}
                </td>
                <td
                  className={clsx(
                    "px-4 py-0 whitespace-pre",
                    line.lineType === "add" && "text-green-800 dark:text-green-300",
                    line.lineType === "delete" && "text-red-700 dark:text-red-300",
                    line.lineType === "context" && "text-gray-700 dark:text-gray-300"
                  )}
                >
                  <span className="mr-2 select-none text-gray-300 dark:text-gray-600">
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
      <table className="w-1/2 border-collapse border-r border-gray-200 dark:border-gray-800">
        <tbody>
          {diff.hunks.map((hunk, hi) => (
            <Fragment key={`left-hunk-${hi}`}>
              <tr className="bg-blue-50 dark:bg-blue-950/30">
                <td className="px-2 py-0.5 text-blue-400 select-none w-10 text-right border-r border-blue-100 dark:border-blue-900">
                  ...
                </td>
                <td className="px-4 py-0.5 text-blue-500 dark:text-blue-400">
                  {hunk.header}
                </td>
              </tr>
              {hunk.lines
                .filter((l) => l.lineType !== "add")
                .map((line, li) => (
                  <tr
                    key={`left-line-${hi}-${li}`}
                    className={
                      line.lineType === "delete" ? "bg-red-50 dark:bg-red-950/30" : ""
                    }
                  >
                    <td className="px-2 py-0 text-gray-400 select-none w-10 text-right border-r border-gray-100 dark:border-gray-800">
                      {line.oldLineNo ?? ""}
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-0 whitespace-pre",
                        line.lineType === "delete"
                          ? "text-red-700 dark:text-red-300"
                          : "text-gray-700 dark:text-gray-300"
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
              <tr className="bg-blue-50 dark:bg-blue-950/30">
                <td className="px-2 py-0.5 text-blue-400 select-none w-10 text-right border-r border-blue-100 dark:border-blue-900">
                  ...
                </td>
                <td className="px-4 py-0.5 text-blue-500 dark:text-blue-400">
                  {hunk.header}
                </td>
              </tr>
              {hunk.lines
                .filter((l) => l.lineType !== "delete")
                .map((line, li) => (
                  <tr
                    key={`right-line-${hi}-${li}`}
                    className={
                      line.lineType === "add" ? "bg-green-50 dark:bg-green-950/30" : ""
                    }
                  >
                    <td className="px-2 py-0 text-gray-400 select-none w-10 text-right border-r border-gray-100 dark:border-gray-800">
                      {line.newLineNo ?? ""}
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-0 whitespace-pre",
                        line.lineType === "add"
                          ? "text-green-800 dark:text-green-300"
                          : "text-gray-700 dark:text-gray-300"
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
