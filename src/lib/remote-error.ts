/**
 * 백엔드가 코드로 돌려주는 원격 선택 오류(`commands/git.rs`의 `remote_error`)를 번역 키로 바꾼다.
 * 코드가 아니면 `null`(그 메시지를 그대로 보여 준다).
 */
export function remoteErrorKey(message: string): string | null {
  if (message.startsWith("no_upstream:")) return "sync.noUpstreamError";
  if (message === "no_remote") return "sync.noRemoteError";
  if (message === "multiple_remotes") return "sync.multipleRemotesError";
  if (message === "detached_head") return "sync.detachedHeadError";
  return null;
}
