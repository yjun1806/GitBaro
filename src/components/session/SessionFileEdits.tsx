import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, EyeOff, Terminal, Bot, Scissors, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortEditsByRisk } from "./session-signals";
import type { FileEditSummary } from "@/types";

interface SessionFileEditsProps {
  edits: FileEditSummary[];
  filesRead: string[];
}

interface EditRowProps {
  edit: FileEditSummary;
}

/** One flag chip. Every flag is a reason to look, never a verdict on the code. */
function Flag({
  icon: Icon,
  label,
  note,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  note: string;
  tone: "muted" | "warning";
}) {
  return (
    <span
      title={note}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
        tone === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function EditRow({ edit }: EditRowProps) {
  const { t } = useTranslation();

  return (
    <li className="flex flex-col gap-1 px-3 py-2 border-b border-border last:border-b-0">
      <span className="text-xs font-mono truncate" title={edit.path}>
        {edit.path}
      </span>
      <div className="flex items-center gap-1 flex-wrap">
        {!edit.wasReadFirst && (
          <Flag
            icon={EyeOff}
            label={t("verify.session.notReadFirst")}
            note={t("verify.session.readLessNote")}
            tone="warning"
          />
        )}
        {edit.viaBash && (
          <Flag
            icon={Terminal}
            label={t("verify.session.viaBash")}
            note={t("verify.session.viaBashNote")}
            tone="warning"
          />
        )}
        {edit.afterCompaction && (
          <Flag
            icon={Scissors}
            label={t("verify.session.afterCompaction")}
            note={t("verify.session.compactionNote")}
            tone="muted"
          />
        )}
        {edit.editCount > 1 && (
          <Flag
            icon={Repeat}
            label={t("verify.session.editCount", { count: edit.editCount })}
            note={t("verify.session.churnNote")}
            tone="muted"
          />
        )}
      </div>
    </li>
  );
}

/**
 * V19 · V22 · V23 · V24 · V25 — what the session touched, ordered by how much
 * reason there is to read it first.
 *
 * Subagent edits (V23) are isolated into their own block because their full
 * content never reached the main context: neither the user nor the main agent
 * saw more than a summary of them.
 */
export function SessionFileEdits({ edits, filesRead }: SessionFileEditsProps) {
  const { t } = useTranslation();
  const [readOpen, setReadOpen] = useState(false);

  const subagentEdits = sortEditsByRisk(edits.filter((e) => e.bySubagent));
  const mainEdits = sortEditsByRisk(edits.filter((e) => !e.bySubagent));

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-md border border-border overflow-hidden">
        <header className="flex items-center gap-1.5 px-3 py-2 bg-surface">
          <h3 className="text-xs font-semibold">{t("verify.session.headingFilesEdited")}</h3>
          <span className="text-[10px] text-muted-foreground">
            {t("verify.session.filesEdited", { count: edits.length })}
          </span>
        </header>
        {mainEdits.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("verify.session.noFilesEdited")}
          </p>
        ) : (
          <ul>
            {mainEdits.map((edit) => (
              <EditRow key={edit.path} edit={edit} />
            ))}
          </ul>
        )}
      </div>

      {subagentEdits.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <header className="flex items-center gap-1.5 px-3 py-2 bg-surface">
            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold">
              {t("verify.session.headingSubagentEdits")}
            </h3>
          </header>
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">
            {t("verify.session.subagentNote")}
          </p>
          <ul>
            {subagentEdits.map((edit) => (
              <EditRow key={edit.path} edit={edit} />
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setReadOpen((open) => !open)}
          className="w-full flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-accent transition-colors text-left"
        >
          {readOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <h3 className="text-xs font-semibold">{t("verify.session.headingFilesRead")}</h3>
          <span className="text-[10px] text-muted-foreground">
            {t("verify.session.filesRead", { count: filesRead.length })}
          </span>
        </button>
        {readOpen &&
          (filesRead.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t("verify.session.noFilesRead")}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {filesRead.map((path) => (
                <li
                  key={path}
                  title={path}
                  className="px-3 py-1.5 text-xs font-mono truncate border-b border-border last:border-b-0"
                >
                  {path}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
