import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { Eye, FolderGit2, GitBranch, Trash2 } from "lucide-react";
import { removeWorktree } from "@/api/commands";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useToastStore } from "@/stores/toast";
import { useRepositoryStore } from "@/stores/repository";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { ContextMenu, contextMenuPoint, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem, folderMenuItems } from "@/components/ui/menu-items";
import { getErrorMessage } from "@/lib/utils";
import type { ViewTarget } from "@/stores/history-view";
import type { RepoInfo } from "@/types";

const ICON = "w-3.5 h-3.5";

/** 저장소 카드 안 작업 폴더 줄 하나(기본 폴더 또는 링크된 워크트리). */
export interface FolderRow {
  path: string;
  isPrimary: boolean;
  /** 체크아웃한 브랜치. detached HEAD면 null. */
  branch: string | null;
}

interface RowMenuActions {
  onSelectRepo: (repo: RepoInfo) => void;
  onSelectWorktree: (repo: RepoInfo, worktreePath: string) => void;
  onViewBranch: (repo: RepoInfo, target: ViewTarget) => void;
}

type OpenMenu =
  | { kind: "folder"; repo: RepoInfo; folder: FolderRow; x: number; y: number }
  | { kind: "view"; repo: RepoInfo; target: Extract<ViewTarget, { kind: "ref" }>; x: number; y: number };

/**
 * 사이드바 저장소 카드 안 줄의 우클릭 메뉴.
 * - 작업 폴더 줄: 열기, (워크트리면) 기본 폴더에서 그 브랜치를 체크아웃하지 않고 보기, 폴더 열기,
 *   경로·브랜치 복사, 맨 아래에 워크트리 제거(확인 창).
 * - 체크아웃하지 않은 작업 중인 브랜치 줄: 보기, 기본 폴더가 열려 있으면 여기서 체크아웃(변경이 있으면 묻는다), 이름 복사.
 */
export function useSidebarRowMenus(
  actions: RowMenuActions,
  activePath: string | null,
): {
  openFolder: (repo: RepoInfo, folder: FolderRow, e: MouseEvent) => void;
  openView: (repo: RepoInfo, target: Extract<ViewTarget, { kind: "ref" }>, e: MouseEvent) => void;
  element: ReactNode;
} {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // 체크아웃은 확인 창이 메뉴보다 오래 남으므로 따로 둔다. 처음 쓸 때 붙이고 그 뒤로는 남겨 둔다.
  const [checkoutRequest, setCheckoutRequest] = useState<{ branch: string; id: number } | null>(null);

  const close = () => setMenu(null);
  const element = (
    <>
      {menu?.kind === "folder" && (
        <FolderRowMenu menu={menu} actions={actions} activePath={activePath} onClose={close} />
      )}
      {menu?.kind === "view" && (
        <ViewRowMenu
          menu={menu}
          actions={actions}
          canCheckout={activePath === menu.repo.path}
          onCheckout={(branch) => setCheckoutRequest((prev) => ({ branch, id: (prev?.id ?? 0) + 1 }))}
          onClose={close}
        />
      )}
      {checkoutRequest && <CheckoutRunner key={checkoutRequest.id} branch={checkoutRequest.branch} />}
    </>
  );

  return {
    openFolder: (repo, folder, e) => {
      e.preventDefault();
      setMenu({ kind: "folder", repo, folder, ...contextMenuPoint(e) });
    },
    openView: (repo, target, e) => {
      e.preventDefault();
      setMenu({ kind: "view", repo, target, ...contextMenuPoint(e) });
    },
    element,
  };
}

function FolderRowMenu({
  menu,
  actions,
  activePath,
  onClose,
}: {
  menu: Extract<OpenMenu, { kind: "folder" }>;
  actions: RowMenuActions;
  activePath: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuActions = useMenuActions();
  const queryClient = useQueryClient();
  const { repo, folder } = menu;
  const isOpen = activePath === folder.path;
  const folderName = folder.path.split("/").filter(Boolean).pop() ?? folder.path;

  const handleRemove = async () => {
    const ok = await ask(t("worktree.removeConfirm", { path: folderName }), {
      title: t("worktree.remove"),
      kind: "warning",
    });
    if (!ok) return;
    const { addToast } = useToastStore.getState();
    try {
      await removeWorktree(repo.path, folder.path);
      // 이 저장소를 다시 열 때 지운 워크트리로 돌아가지 않도록 기억을 지운다.
      const { activeWorktrees, rememberWorktree } = useRepositoryStore.getState();
      if (activeWorktrees[repo.path] === folder.path) rememberWorktree(repo.path, null);
      addToast(t("worktree.removed", { path: folderName }), "success");
    } catch (err) {
      addToast(t("worktree.failedToRemove", { error: getErrorMessage(err) }), "error");
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["worktrees"] }),
        queryClient.invalidateQueries({ queryKey: ["reviewStatus"] }),
      ]);
    }
  };

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: folder.isPrimary ? t("menu.openPrimaryFolder") : t("menu.openWorktree"),
          icon: <FolderGit2 className={ICON} />,
          onClick: () => (folder.isPrimary ? actions.onSelectRepo(repo) : actions.onSelectWorktree(repo, folder.path)),
          disabled: isOpen,
        },
        ...(!folder.isPrimary && folder.branch
          ? [
              {
                label: t("menu.viewInPrimary"),
                icon: <Eye className={ICON} />,
                onClick: () => actions.onViewBranch(repo, { kind: "ref", name: folder.branch!, isRemote: false }),
              },
            ]
          : []),
      ],
    },
    { items: folderMenuItems(t, menuActions, folder.path) },
    {
      items: [
        copyMenuItem(t("menu.copyPath"), folder.path, menuActions),
        ...(folder.branch ? [copyMenuItem(t("branch.contextMenu.copyName"), folder.branch, menuActions)] : []),
      ],
    },
  ];
  if (!folder.isPrimary) {
    sections.push({
      items: [
        {
          label: t("menu.removeWorktree"),
          icon: <Trash2 className={ICON} />,
          variant: "danger",
          onClick: () => void handleRemove(),
          // 지금 연 워크트리는 지우지 않는다(툴바 워크트리 패널과 같은 규칙).
          disabled: isOpen,
        },
      ],
    });
  }
  return <ContextMenu sections={sections} position={menu} onClose={onClose} ariaLabel={t("menu.worktreeMenu")} />;
}

function ViewRowMenu({
  menu,
  actions,
  canCheckout,
  onCheckout,
  onClose,
}: {
  menu: Extract<OpenMenu, { kind: "view" }>;
  actions: RowMenuActions;
  canCheckout: boolean;
  onCheckout: (branch: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuActions = useMenuActions();
  const { repo, target } = menu;
  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("menu.viewBranch"),
          icon: <Eye className={ICON} />,
          onClick: () => actions.onViewBranch(repo, target),
        },
        {
          label: t("menu.checkoutHere"),
          icon: <GitBranch className={ICON} />,
          onClick: () => onCheckout(target.name),
          // 기본 폴더가 열려 있을 때만 그 자리에서 체크아웃한다(다른 저장소를 몰래 바꾸지 않는다).
          disabled: !canCheckout,
        },
      ],
    },
    { items: [copyMenuItem(t("branch.contextMenu.copyName"), target.name, menuActions)] },
  ];
  return <ContextMenu sections={sections} position={menu} onClose={onClose} ariaLabel={t("menu.branchMenu")} />;
}

/**
 * 붙은 뒤 목록(브랜치·변경·워크트리)을 다 읽으면 체크아웃을 시작하고, 확인 창(커밋 안 한 변경이 있을 때)을
 * 그린다. 목록을 읽기 전에 시작하면 변경이 없는 것으로 보고 묻지 않고 바꿔 버린다.
 */
function CheckoutRunner({ branch }: { branch: string }) {
  const { checkout, element, ready } = useCheckoutBranch();
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started || !ready) return;
    setStarted(true);
    checkout(branch);
  }, [started, ready, checkout, branch]);
  return <>{element}</>;
}
