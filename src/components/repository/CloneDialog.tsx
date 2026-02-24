import { useState } from "react";
import { X, FolderOpen, Search, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { GitHubAccount } from "@/types";

type Tab = "github" | "url";

interface CloneDialogProps {
  accounts: GitHubAccount[];
  selectedAccountId: string | null;
  onAccountChange: (accountId: string) => void;
  onClone: (params: { url: string; localPath: string; accountId: string | null }) => void;
  onClose: () => void;
}

export function CloneDialog({
  accounts,
  selectedAccountId,
  onAccountChange,
  onClone,
  onClose,
}: CloneDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("github");
  const [repoSearch, setRepoSearch] = useState("");
  const [url, setUrl] = useState("");
  const [localPath, setLocalPath] = useState("");

  const handleClone = () => {
    const cloneUrl = tab === "url" ? url : "";
    if (!cloneUrl && tab === "url") return;
    onClone({ url: cloneUrl, localPath, accountId: selectedAccountId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("repo.clone")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          {(["github", "url"] as Tab[]).map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              className={clsx(
                "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t_
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t_ === "github" ? "GitHub.com" : "URL"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {tab === "github" && (
            <>
              {/* Account selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("clone.account")}
                </label>
                <select
                  value={selectedAccountId ?? ""}
                  onChange={(e) => onAccountChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t("clone.selectAccount")}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.username}
                    </option>
                  ))}
                </select>
              </div>

              {/* Repo search */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("clone.repository")}
                </label>
                <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg">
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder={t("clone.searchRepos")}
                    className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {tab === "url" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("clone.repositoryUrl")}
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}

          {/* Local path */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("clone.localPath")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="~/Projects/..."
                className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                <FolderOpen className="w-4 h-4" />
                {t("common.browse")}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleClone}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            {t("clone.clone")}
          </button>
        </div>
      </div>
    </div>
  );
}
