import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionCumulativeDiff } from "@/api/queries";
import type { SessionDiffFile } from "@/types";

interface SessionCumulativeDiffProps {
  repoPath: string;
  sessionPath: string;
}

/** Rendered lines are capped per file — a session's net diff can be very large. */
const MAX_LINES_PER_FILE = 400;

function fileLabel(file: SessionDiffFile): string {
  if (file.newPath && file.oldPath && file.newPath !== file.oldPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "";
}

function countChanges(file: SessionDiffFile): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.origin === "+") added += 1;
      else if (line.origin === "-") removed += 1;
    }
  }
  return { added, removed };
}

function FileDiff({ file }: { file: SessionDiffFile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label = fileLabel(file);
  const { added, removed } = countChanges(file);
  const lines = file.hunks.flatMap((hunk) => [
    { origin: "H", content: hunk.header, key: `${hunk.header}-${hunk.newStart}` },
    ...hunk.lines.map((line, index) => ({
      origin: line.origin,
      content: line.content,
      key: `${hunk.newStart}-${index}`,
    })),
  ]);
  const visible = lines.slice(0, MAX_LINES_PER_FILE);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="flex-1 min-w-0 text-xs font-mono truncate" title={label}>
          {label}
        </span>
        {file.isBinary ? (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {t("verify.session.binaryFile")}
          </span>
        ) : (
          <span className="text-[10px] shrink-0 tabular-nums">
            <span className="text-diff-add-fg">+{added}</span>{" "}
            <span className="text-diff-del-fg">-{removed}</span>
          </span>
        )}
      </button>

      {open && !file.isBinary && (
        <div className="overflow-x-auto bg-surface">
          <pre className="text-[11px] font-mono leading-relaxed">
            {visible.map((line) => (
              <div
                key={line.key}
                className={cn(
                  "px-3 whitespace-pre",
                  line.origin === "+" && "bg-diff-add text-diff-add-fg",
                  line.origin === "-" && "bg-diff-del text-diff-del-fg",
                  line.origin === "H" && "bg-diff-hunk text-diff-hunk-fg",
                )}
              >
                {line.origin === "H" ? line.content : `${line.origin}${line.content}`}
              </div>
            ))}
          </pre>
          {lines.length > visible.length && (
            <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
              {t("verify.session.diffTruncated", { count: MAX_LINES_PER_FILE })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * V30 — the natural unit of review is the session, not the commit.
 *
 * Thirty commits are often three sessions, and reviewing commit by commit means
 * reading code that was added and then deleted again within the same intent.
 * This shows the session's *net* change against its start-of-session baseline.
 *
 * The query walks commits, so it stays behind an explicit click rather than
 * running for every selected session.
 */
export function SessionCumulativeDiff({ repoPath, sessionPath }: SessionCumulativeDiffProps) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const { data, isLoading, isError } = useSessionCumulativeDiff(
    repoPath,
    sessionPath,
    requested,
  );

  return (
    <section className="rounded-md border border-border overflow-hidden">
      <header className="flex items-center gap-1.5 px-3 py-2 bg-surface">
        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold">{t("verify.session.cumulativeDiff")}</h3>
      </header>
      <p className="px-3 pt-2 text-[11px] text-muted-foreground">
        {t("verify.session.cumulativeDiffNote")}
      </p>

      {!requested ? (
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => setRequested(true)}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent transition-colors"
          >
            {t("verify.session.showCumulativeDiff")}
          </button>
        </div>
      ) : isLoading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {t("verify.session.cumulativeDiffLoading")}
        </p>
      ) : isError || !data || data.files.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {t("verify.session.cumulativeDiffEmpty")}
        </p>
      ) : (
        <>
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
            {t("verify.session.cumulativeDiffFiles", { count: data.files.length })}
          </p>
          <ul className="border-t border-border">
            {data.files.map((file) => (
              <FileDiff key={fileLabel(file)} file={file} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
