/**
 * 백엔드가 코드로 돌려주는 원격 선택 오류(`commands/git.rs`의 `remote_error`)를 번역 키로 바꾼다.
 * 코드가 아니면 `null`(그 메시지를 그대로 보여 준다).
 */
export function remoteErrorKey(message: string): string | null {
  if (message.startsWith("no_upstream:")) return "sync.noUpstreamError";
  if (message === "no_remote") return "sync.noRemoteError";
  if (message === "multiple_remotes") return "sync.multipleRemotesError";
  if (message === "detached_head") return "sync.detachedHeadError";
  if (message === "credential_prompt_blocked") return "sync.credentialPromptBlocked";
  return null;
}

/**
 * 계정의 GitHub 로그인이 없거나 만료되어 원격 작업이 실패했으면 그 계정 이름, 아니면 `null`.
 * 백엔드는 이 경우 git 원문 대신 `{ type: "TokenExpired", accountId }`를 보낸다.
 */
export function signInErrorAccount(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { type, accountId } = error as { type?: unknown; accountId?: unknown };
  return type === "TokenExpired" && typeof accountId === "string" ? accountId : null;
}
