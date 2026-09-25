import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { listWorkflowRuns } from "@/api/commands";
import { useBackgroundReviewStatus } from "@/hooks/useBackgroundReviewStatus";
import { useRepositoryStore } from "@/stores/repository";
import { repoNameNow } from "@/hooks/useRepoDisplay";
import { gitHubRepoUrl } from "@/lib/utils";
import { EMPTY_CI_SEEN, forgetUnwatchedRepos, pickNewFailures, type CiSeen } from "@/lib/notify/ci-failures";
import { deliverNotification } from "@/lib/notify/deliver";
import { isRepoNotifyOn } from "@/lib/notify/repo-override";
import { useNotifyStore } from "@/stores/notify";
import type { WorkflowRun } from "@/types";

/** GitHub Actions 실행 목록을 읽는 주기. 저장소마다 한 번씩 API 를 부른다. */
const CI_POLL_MS = 60_000;

/**
 * 등록된 GitHub 저장소에서 지금 체크아웃한 브랜치(메인 작업 트리와 워크트리 모두)의 Actions 실행이
 * 실패(`failure`·`timed_out`)하면 실행마다 한 번 알린다. 계정이 연결되지 않은 저장소는 읽지 않는다.
 * 앱을 켠 뒤 처음 읽은 목록에 이미 있던 실패는 알리지 않는다.
 */
export function useCiFailureNotifications(enabled: boolean): void {
  const { t } = useTranslation();
  const repos = useRepositoryStore((s) => s.repos);
  const repoPrefs = useRepositoryStore((s) => s.repoPrefs);
  const settings = useNotifyStore((s) => s.settings);
  // 이 알림이 꺼진 저장소(저장소 설정 또는 앱 설정)는 Actions 를 읽지도 않는다. 다시 켜면 처음 읽는 것처럼 조용히 기록한다.
  const targets = useMemo(
    () =>
      repos.filter(
        (r) =>
          r.accountId !== null &&
          gitHubRepoUrl(r.remotes) !== null &&
          isRepoNotifyOn(settings, repoPrefs, r.path, "ciFailures"),
      ),
    [repos, repoPrefs, settings],
  );
  const review = useBackgroundReviewStatus(enabled);

  // Actions 탭과 같은 키라 결과를 함께 쓴다.
  const runs = useQueries({
    queries: targets.map((repo) => ({
      queryKey: ["workflowRuns", repo.path, repo.accountId],
      queryFn: () => listWorkflowRuns(repo.path, repo.accountId as string),
      enabled,
      refetchInterval: CI_POLL_MS,
      refetchIntervalInBackground: true,
      staleTime: 10_000,
      retry: false,
    })),
  });

  const seen = useRef<CiSeen>(EMPTY_CI_SEEN);
  // 이미 살펴본 결과 배열. 같은 결과를 렌더마다 다시 보지 않는다.
  const handled = useRef(new WeakSet<WorkflowRun[]>());

  useEffect(() => {
    if (enabled) return;
    seen.current = EMPTY_CI_SEEN;
    handled.current = new WeakSet();
  }, [enabled]);

  useEffect(() => {
    seen.current = forgetUnwatchedRepos(seen.current, new Set(targets.map((r) => r.path)));
  }, [targets]);

  const reviewRepos = review.data;
  useEffect(() => {
    // 브랜치를 모르는 채로 보면 지금 브랜치의 실패까지 「본 것」으로 적어 버린다. 워크트리 목록을 기다린다.
    if (!enabled || !reviewRepos) return;
    targets.forEach((repo, i) => {
      const data = runs[i]?.data;
      if (!data || handled.current.has(data)) return;
      const worktrees = reviewRepos.find((r) => r.repoPath === repo.path)?.worktrees;
      if (!worktrees) return;
      handled.current.add(data);
      const branches = new Set(worktrees.flatMap((wt) => (wt.branch ? [wt.branch] : [])));
      const result = pickNewFailures(seen.current, repo.path, data, branches);
      seen.current = result.seen;
      for (const run of result.notify) {
        const worktree = worktrees.find((wt) => wt.branch === run.headBranch);
        void deliverNotification({
          title: t("notify.ciFailedTitle", {
            repo: repoNameNow(repo),
            branch: run.headBranch,
            workflow: run.name || t("notify.ciUnnamedWorkflow"),
          }),
          body: t(run.conclusion === "timed_out" ? "notify.ciTimedOutBody" : "notify.ciFailedBody", {
            number: run.runNumber,
          }),
          target: { kind: "ci", repoPath: repo.path, worktreePath: worktree?.path ?? repo.path, runId: run.id },
        });
      }
    });
  }, [enabled, reviewRepos, targets, runs, t]);
}
