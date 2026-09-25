import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { TAURI_EVENTS } from "@/api/events";
import { getHeadAdvance } from "@/api/commands";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useBackgroundReviewStatus } from "@/hooks/useBackgroundReviewStatus";
import { useActivityStore } from "@/stores/activity";
import { useRepositoryStore } from "@/stores/repository";
import { repoNameNow } from "@/hooks/useRepoDisplay";
import { truncateHash } from "@/lib/utils";
import { diffHeads, type HeadSnapshot } from "@/lib/notify/head-moves";
import { EMPTY_IN_APP_OPS, isCausedInApp, opEnded, opStarted, type InAppOps } from "@/lib/notify/in-app-ops";
import { addToBurst, takeDueBursts, type CommitBurst, type CommitBursts } from "@/lib/notify/commit-burst";
import { deliverNotification } from "@/lib/notify/deliver";
import { isRepoNotifyOn } from "@/lib/notify/repo-override";
import { useNotifyStore } from "@/stores/notify";

/** 묶음이 찼는지 보는 주기. */
const BURST_CHECK_MS = 1_000;

/**
 * 등록된 저장소와 그 워크트리에 새 커밋이 생기면 알린다.
 *
 * - HEAD 는 워크트리 목록(`review_status`)으로 읽는다. git 메타데이터가 바뀌었다는 `repo:activity`
 *   (`kind: "git"`)를 받으면 바로 다시 읽고, 감시 상한을 넘긴 곳은 20초 주기로 읽는다. 창이 뒤에
 *   있어도 읽는다 — 알림은 그때 쓸모 있다.
 * - 처음 본 HEAD 는 기록만 한다(앱 시작 때 알림이 쏟아지지 않게). 같은 브랜치에서 새 커밋이
 *   얹혀 앞으로 나아간 것만 알린다(`get_head_advance`). 체크아웃·reset·rebase 는 알리지 않는다.
 * - 앱 안에서 돌린 git 작업(커밋·pull·merge 등, 활동 스토어의 진행 중 작업)이 그 사이에 있었으면 알리지 않는다.
 * - 워크트리마다 10초 안에 쌓인 커밋은 한 알림으로 묶는다.
 */
export function useCommitNotifications(enabled: boolean): void {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useBackgroundReviewStatus(enabled);

  const heads = useRef<HeadSnapshot>({});
  const bursts = useRef<CommitBursts>({});
  const ops = useRef<InAppOps>(EMPTY_IN_APP_OPS);

  // 앱 안 작업은 알림을 끈 동안에도 기록한다. 켜자마자 들어온 이동을 가려야 한다.
  useEffect(
    () =>
      useActivityStore.subscribe((state, prev) => {
        if (state.activeOperations === prev.activeOperations) return;
        const now = Date.now();
        for (const [id, entry] of Object.entries(state.activeOperations)) {
          if (!(id in prev.activeOperations)) ops.current = opStarted(ops.current, entry);
        }
        for (const id of Object.keys(prev.activeOperations)) {
          if (!(id in state.activeOperations)) ops.current = opEnded(ops.current, id, now);
        }
      }),
    [],
  );

  useTauriEvent(
    TAURI_EVENTS.repoActivity,
    (activity) => {
      if (activity.kind === "git") void queryClient.invalidateQueries({ queryKey: ["reviewStatus"] });
    },
    enabled,
  );

  // 알림을 끄면 기록을 비운다. 다시 켰을 때 꺼 둔 동안의 커밋을 몰아서 알리지 않는다.
  useEffect(() => {
    if (enabled) return;
    heads.current = {};
    bursts.current = {};
  }, [enabled]);

  const { data, dataUpdatedAt } = status;
  useEffect(() => {
    if (!enabled || !data) return;
    const { next, moves } = diffHeads(heads.current, data, dataUpdatedAt);
    heads.current = next;
    for (const move of moves) {
      if (isCausedInApp(ops.current, move.worktreePath, move.previousSeenAt)) continue;
      getHeadAdvance(move.worktreePath, move.from, move.to)
        .then((advance) => {
          if (!advance.isDescendant || advance.count === 0) return;
          bursts.current = addToBurst(
            bursts.current,
            { ...move, count: advance.count, latestSubject: advance.subjects[0] ?? null },
            Date.now(),
          );
        })
        .catch(() => {
          /* 판별하지 못한 이동은 알리지 않는다 */
        });
    }
  }, [enabled, data, dataUpdatedAt]);

  useEffect(() => {
    if (!enabled) return;
    const describe = (burst: CommitBurst) => {
      const repo = useRepositoryStore.getState().repos.find((r) => r.path === burst.repoPath);
      const repoName = repo
        ? repoNameNow(repo)
        : burst.repoPath.split("/").pop() ?? burst.repoPath;
      const where = burst.branch ?? truncateHash(burst.latestOid);
      return {
        title: t("notify.newCommitsTitle", { repo: repoName, branch: where, count: burst.count }),
        body: burst.latestSubject ?? "",
        target: {
          kind: "commit" as const,
          repoPath: burst.repoPath,
          worktreePath: burst.worktreePath,
          commitOid: burst.latestOid,
        },
      };
    };
    const timer = setInterval(() => {
      const { due, rest } = takeDueBursts(bursts.current, Date.now());
      if (due.length === 0) return;
      bursts.current = rest;
      // 저장소 설정에서 이 저장소만 끈 알림은 보내지 않는다.
      const settings = useNotifyStore.getState().settings;
      const prefs = useRepositoryStore.getState().repoPrefs;
      for (const burst of due) {
        if (isRepoNotifyOn(settings, prefs, burst.repoPath, "newCommits")) void deliverNotification(describe(burst));
      }
    }, BURST_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, t]);
}
