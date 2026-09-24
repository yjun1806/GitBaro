import { useId } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { avatarColor } from "@/lib/avatar-color";
import { cn, formatRelativeTime } from "@/lib/utils";
import { remoteErrorKey } from "@/lib/remote-error";
import {
  isRunnable,
  isSelectable,
  isStaleUpToDate,
  useMultiRepoRemote,
  type RemotePlanRow,
  type RemoteRowResult,
} from "@/hooks/useMultiRepoRemote";
import type { RemoteOp } from "@/types";

export interface MultiRepoRemoteDialogProps {
  /** 워크스페이스 저장소 경로. */
  paths: string[];
  op: RemoteOp;
  onClose: () => void;
}

const GRID = "grid grid-cols-[20px_150px_minmax(0,1fr)_96px] gap-2.5 items-center";

/**
 * 여러 저장소 Fetch·Pull·Push 확인 창(시안 D3, `gen_d.py`의 `push_menu`).
 * 저장소마다 실행할 git 명령과 커밋 수를 보여 주고, 확인을 눌러야만 저장소별로 따로 실행한다.
 * force push는 제공하지 않는다.
 */
export function MultiRepoRemoteDialog({ paths, op, onClose }: MultiRepoRemoteDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const { phase, rows, selected, pullFirst, results, error, chosen, toggle, togglePullFirst, run } =
    useMultiRepoRemote(paths, op);

  const count = phase === "preparing" ? paths.length : chosen.length;
  const running = phase === "running";
  const done = phase === "done";
  const needsPullRows = op === "push" ? rows.filter((r) => isRunnable(r) && r.plan.needsPull) : [];
  const notes = noteLines(rows, op, t);
  const okCount = Object.values(results).filter((r) => r.status === "ok").length;
  const failedCount = Object.values(results).filter(
    (r) => r.status === "failed" || r.status === "conflict",
  ).length;

  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      dismissible={!running}
      className="bg-card rounded-[14px] shadow-2xl w-full max-w-[620px] mx-4 overflow-hidden ring-1 ring-(--line)"
    >
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex items-start gap-2">
          <h3 id={titleId} className="flex-1 text-[15px] font-bold text-foreground">
            {t(`multiRepoRemote.title.${op}`, { count })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label={t("multiRepoRemote.close")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[12.5px] leading-[19px] text-muted-foreground">
          {t(`multiRepoRemote.description.${op}`)}
        </p>
      </div>

      {phase === "preparing" && (
        <div className="flex items-center gap-2 px-4 py-6 border-t border-(--line) text-[12.5px] text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {/* Fetch는 창을 열 때 미리 fetch하지 않는다(실행 자체가 fetch). */}
          {t(op === "fetch" ? "multiRepoRemote.preparingFetch" : "multiRepoRemote.preparing")}
        </div>
      )}

      {phase === "failed" && (
        <div role="alert" className="px-4 py-4 border-t border-(--line) text-[12.5px] text-danger">
          {t("multiRepoRemote.prepareFailed", { error })}
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div
            className={cn(GRID, "px-4 py-1.5 text-[11px] font-semibold text-(--faint) bg-(--chip)")}
          >
            <span />
            <span>{t("multiRepoRemote.colRepo")}</span>
            <span>{t("multiRepoRemote.colCommand")}</span>
            <span className="text-right">
              {t("multiRepoRemote.colCommits")}
            </span>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {rows.map((row) => (
              <PlanRow
                key={row.plan.path}
                row={row}
                op={op}
                checked={selected.has(row.plan.path)}
                locked={phase !== "ready"}
                result={results[row.plan.path]}
                onToggle={() => toggle(row.plan.path)}
              />
            ))}
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-4 py-3 border-t border-(--line) bg-(--acc-faint)">
          {notes.map((note) => (
            <li key={note} className="text-[12px] text-foreground/80">
              • {note}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 px-4 py-3 border-t border-(--line)">
        <div className="flex flex-col gap-1 min-w-0">
          {!done &&
            needsPullRows.map((row) => (
              <label
                key={row.plan.path}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <input
                  type="checkbox"
                  className="m-0 accent-(--acc)"
                  checked={pullFirst.has(row.plan.path)}
                  disabled={phase !== "ready" || !selected.has(row.plan.path)}
                  onChange={() => togglePullFirst(row.plan.path)}
                />
                {t("multiRepoRemote.pullFirst", { name: row.name })}
              </label>
            ))}
          {done && (
            <span role="status" className="text-[12px] text-muted-foreground">
              {t("multiRepoRemote.summary", { ok: okCount, failed: failedCount })}
            </span>
          )}
        </div>
        <span className="grow" />
        {done ? (
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold hover:bg-primary-hover"
          >
            {t("multiRepoRemote.close")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="h-8 px-3.5 rounded-lg bg-(--chip) text-[13px] font-semibold text-foreground/80 hover:bg-muted disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={phase !== "ready" || chosen.length === 0}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold hover:bg-primary-hover disabled:opacity-50"
            >
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {t(`multiRepoRemote.confirm.${op}`, { count: chosen.length })}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

interface PlanRowProps {
  row: RemotePlanRow;
  op: RemoteOp;
  checked: boolean;
  locked: boolean;
  result: RemoteRowResult | undefined;
  onToggle: () => void;
}

function PlanRow({ row, op, checked, locked, result, onToggle }: PlanRowProps) {
  const { t } = useTranslation();
  const selectable = isSelectable(row);
  const { plan } = row;
  const color = avatarColor(row.name);
  return (
    <div
      data-testid={`plan-row-${row.name}`}
      data-skipped={!isRunnable(row) || undefined}
      className={cn("px-4 py-2.5 border-t border-(--line)", !selectable && "opacity-50")}
    >
      <div className={GRID}>
        <input
          type="checkbox"
          aria-label={row.name}
          className="m-0 accent-(--acc)"
          checked={selectable && checked}
          disabled={!selectable || locked}
          onChange={onToggle}
        />
        <span className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="flex items-center justify-center w-[18px] h-[18px] shrink-0 rounded-[5px] text-[10px] font-bold"
            style={{ background: color.background, color: color.foreground }}
          >
            {row.name.charAt(0).toUpperCase()}
          </span>
          <strong className="truncate text-[12.5px] text-foreground">{row.name}</strong>
        </span>
        <span className="min-w-0 flex flex-col">
          <code className="font-mono text-[11.5px] text-foreground/80 break-all">{plan.command ?? "—"}</code>
          {row.fetchFailed && (!plan.skip || isStaleUpToDate(row)) && (
            <span className="flex items-center gap-1 text-[11px] text-warning" data-testid="stale-fetch">
              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
              {row.lastFetchedAt
                ? t("multiRepoRemote.stale", { time: formatRelativeTime(row.lastFetchedAt) })
                : t("multiRepoRemote.staleNever")}
            </span>
          )}
        </span>
        <span className="text-right text-[12px] font-bold text-foreground">
          {result ? <ResultLabel result={result} /> : commitsLabel(row, op, t)}
        </span>
      </div>
      {result?.status === "failed" && (
        <p role="alert" className="mt-1 pl-[30px] text-[11.5px] text-danger break-words">
          {failureText(result.message, t)}
        </p>
      )}
    </div>
  );
}

function ResultLabel({ result }: { result: RemoteRowResult }) {
  const { t } = useTranslation();
  switch (result.status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          {t("multiRepoRemote.result.running")}
        </span>
      );
    case "ok":
      return (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="w-3 h-3" aria-hidden="true" />
          {t("multiRepoRemote.result.ok")}
        </span>
      );
    case "conflict":
      return <span className="text-warning">{t("multiRepoRemote.result.conflict")}</span>;
    case "failed":
      return <span className="text-danger">{t("multiRepoRemote.result.failed")}</span>;
  }
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** 실행 실패 문구. 원격 선택 오류 코드(`detached_head` 등)는 단일 저장소 툴바와 같은 문구로 바꾼다. */
function failureText(message: string, t: Translate): string {
  const key = remoteErrorKey(message);
  return key ? t(key) : message;
}

/** 오른쪽 칸: 건너뛰는 이유, 또는 ↑/↓ 커밋 수. Fetch는 커밋 수를 미리 알 수 없어 비운다. */
function commitsLabel(row: RemotePlanRow, op: RemoteOp, t: Translate): string {
  if (row.accountId === null && !row.plan.skip) return t("multiRepoRemote.skip.noAccount");
  const reason = row.plan.skipReason;
  if (row.plan.skip && reason) {
    return reason === "upToDate"
      ? t(op === "pull" ? "multiRepoRemote.skip.upToDate_pull" : "multiRepoRemote.skip.upToDate_push")
      : t(`multiRepoRemote.skip.${reason}`);
  }
  if (op === "push") return `↑${row.plan.commits}`;
  if (op === "pull") return `↓${row.plan.commits}`;
  return "";
}

/**
 * 표 아래 안내: Pull이 먼저 필요한 저장소, `-u`로 새로 연결하는 저장소, fetch 실패(할 일 없음으로
 * 계획된 저장소 포함), 계정 없음.
 */
function noteLines(rows: RemotePlanRow[], op: RemoteOp, t: Translate): string[] {
  return rows.flatMap((row) => {
    const { plan, name } = row;
    if (plan.skipReason === "error") {
      return [t("multiRepoRemote.notes.error", { name, error: plan.error ?? "" })];
    }
    if (isStaleUpToDate(row)) return [t(`multiRepoRemote.notes.staleUpToDate_${op}`, { name })];
    if (plan.skip) return [];
    if (row.accountId === null) return [t("multiRepoRemote.notes.noAccount", { name })];
    return [
      ...(row.fetchFailed ? [t("multiRepoRemote.notes.fetchFailed", { name })] : []),
      ...(op === "push" && plan.needsPull ? [t("multiRepoRemote.notes.needsPull", { name, count: plan.behind })] : []),
      ...(op === "push" && plan.setsUpstream ? [t("multiRepoRemote.notes.setsUpstream", { name })] : []),
    ];
  });
}
