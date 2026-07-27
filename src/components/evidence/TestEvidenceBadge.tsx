import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { useTestEvidence, useTestRunMutation } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import type { VerifyTestProgressEvent } from "@/types";
import {
  EVIDENCE_TONE_CLASS,
  deriveEvidenceState,
  evidenceTone,
  formatDurationSeconds,
  resolveRunCommand,
  type EvidenceDisplayState,
} from "./evidence-state";

const TONE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface TestEvidenceBadgeProps {
  repoPath: string | null;
  /**
   * 실행할 테스트 명령. 생략하면 마지막으로 실행된 명령을 쓰고, 그것도 없으면 백엔드가
   * 매니페스트에서 탐지한다. **에이전트가 생성한 텍스트를 넣지 말 것** — 이 값은
   * 셸로 그대로 넘어간다.
   */
  detectedCommand?: string | null;
}

/**
 * V11 — 이 워킹트리 상태에 결합된 테스트 실행 증거 한 줄.
 *
 * 상태는 셋뿐이고(미실행 / 만료 / 현재 트리와 일치) 어느 것도 "검증됨"을 뜻하지 않는다.
 * 실행은 **사용자가 버튼을 눌렀을 때만** 일어난다 — 자동 실행 금지.
 */
export function TestEvidenceBadge({ repoPath, detectedCommand }: TestEvidenceBadgeProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: status, isLoading } = useTestEvidence(repoPath);
  const runTests = useTestRunMutation(repoPath);

  const [expanded, setExpanded] = useState(false);
  const [progressLine, setProgressLine] = useState("");

  // 실행 중 마지막 출력 라인만 흘려보낸다. 전체 로그는 증거의 `outputTail`이 갖고 있다.
  useEffect(() => {
    if (!repoPath) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<VerifyTestProgressEvent>("verify:test-progress", (event) => {
      if (!mounted || event.payload.repoPath !== repoPath) return;
      setProgressLine(event.payload.running ? event.payload.line : "");
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [repoPath]);

  if (!repoPath) return null;

  const state = deriveEvidenceState(status);
  const evidence = state.kind === "neverRun" ? null : state.evidence;
  const tone = evidenceTone(state);
  const Icon = TONE_ICON[tone];
  const command = resolveRunCommand(detectedCommand, evidence);
  const running = runTests.isPending;

  async function handleRun() {
    if (!repoPath || running) return;
    setProgressLine("");
    try {
      // 실패한 스위트는 에러가 아니라 증거다 — 토스트 대신 출력을 펼쳐 보여준다.
      const result = await runTests.mutateAsync(command ?? "");
      if (!result.passed) setExpanded(true);
    } catch (err) {
      addToast(t("verify.evidence.runFailed", { error: getErrorMessage(err) }), "error");
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface text-xs">
      <div className="flex items-center gap-2 px-2 py-1.5">
        {running ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : isLoading ? (
          <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Icon className={cn("w-3.5 h-3.5 shrink-0", EVIDENCE_TONE_CLASS[tone])} />
        )}

        <span className="flex-1 min-w-0 truncate">
          {running
            ? t("verify.evidence.running")
            : isLoading
              ? t("common.loading")
              : summaryLine(state, t)}
        </span>

        <code
          className="shrink-0 max-w-[9rem] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          title={command ?? t("verify.evidence.autoDetect")}
        >
          {command ?? t("verify.evidence.autoDetect")}
        </code>

        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className={cn(
            "shrink-0 rounded px-2 py-0.5 font-medium text-accent transition-colors hover:bg-accent/10",
            running && "cursor-not-allowed opacity-50",
          )}
        >
          {running ? t("verify.evidence.running") : t("verify.evidence.run")}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={t("verify.evidence.details")}
          title={t("verify.evidence.details")}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {running && progressLine && (
        <div className="border-t border-border px-2 py-1 font-mono text-[11px] text-muted-foreground truncate">
          {progressLine}
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border px-2 py-2">
          {evidence ? (
            <>
              <DetailRow label={t("verify.evidence.command")} value={evidence.command} mono />
              <DetailRow
                label={t("verify.evidence.duration", {
                  seconds: formatDurationSeconds(evidence.durationMs),
                })}
                value={
                  evidence.exitCode === null
                    ? ""
                    : t("verify.evidence.exitCode", { code: evidence.exitCode })
                }
              />
              {evidence.outputTail && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("verify.evidence.outputTail")}</span>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                    {evidence.outputTail}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">{t("verify.evidence.freshness.absent")}</p>
          )}
          <p className="text-muted-foreground">{t("verify.evidence.claimNote")}</p>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")} title={value}>
        {value}
      </span>
    </div>
  );
}

/** 한 줄 요약: "테스트 통과 · 2분 전 · 현재 트리와 일치". */
function summaryLine(state: EvidenceDisplayState, t: TFunction): string {
  if (state.kind === "neverRun") return t("verify.evidence.freshness.absent");

  const result = t(state.passed ? "verify.evidence.result.passed" : "verify.evidence.result.failed");
  // 검증 타임스탬프는 epoch **밀리초**이고 formatRelativeTime은 초를 받는다.
  const when = formatRelativeTime(state.evidence.ranAt / 1000);
  const freshness =
    state.kind === "fresh"
      ? t("verify.evidence.freshness.fresh")
      : state.changedFiles === null
        ? t("verify.evidence.freshness.staleUnknown")
        : t("verify.evidence.freshness.stale", { count: state.changedFiles });

  return `${result} · ${when} · ${freshness}`;
}
