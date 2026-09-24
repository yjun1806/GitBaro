/**
 * Outcome of running a branch action with the working-tree changes set aside.
 * `leftInStash` means the changes are now an entry in the stash list (a
 * restore failed, or `popOnSuccess` was false). A failed restore always
 * leaves them there.
 */
export type StashedRunOutcome =
  | { status: "done"; leftInStash: boolean }
  | { status: "stashFailed"; error: unknown }
  | { status: "actionFailed"; error: unknown; leftInStash: boolean }
  | { status: "restoreFailed"; error: unknown };

interface StashedRunSteps {
  /** Stashes the changes. Resolves to the created stash's oid, or null when there was nothing to stash. */
  stash: () => Promise<string | null>;
  /** Pops exactly the stash `stash` created. */
  restore: (oid: string) => Promise<void>;
  action: () => Promise<void>;
  /** false keeps the stash after a successful action (the "leave changes here" switch). Defaults to true. */
  popOnSuccess?: boolean;
}

/**
 * Stash → action → pop that same stash. The stash is popped when the action
 * fails (and, unless `popOnSuccess` is false, when it succeeds), and never
 * when nothing was stashed, so an older, unrelated stash is never touched.
 */
export async function runWithStashedChanges({
  stash,
  restore,
  action,
  popOnSuccess = true,
}: StashedRunSteps): Promise<StashedRunOutcome> {
  let oid: string | null;
  try {
    oid = await stash();
  } catch (error) {
    return { status: "stashFailed", error };
  }

  try {
    await action();
  } catch (error) {
    if (oid === null) return { status: "actionFailed", error, leftInStash: false };
    try {
      await restore(oid);
      return { status: "actionFailed", error, leftInStash: false };
    } catch {
      return { status: "actionFailed", error, leftInStash: true };
    }
  }

  if (oid === null) return { status: "done", leftInStash: false };
  if (!popOnSuccess) return { status: "done", leftInStash: true };
  try {
    await restore(oid);
    return { status: "done", leftInStash: false };
  } catch (error) {
    return { status: "restoreFailed", error };
  }
}
