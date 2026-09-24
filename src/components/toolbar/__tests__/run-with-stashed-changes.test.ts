import { describe, expect, it, vi } from "vitest";
import { runWithStashedChanges } from "../run-with-stashed-changes";

const fail = (message: string) => () => Promise.reject(new Error(message));

describe("runWithStashedChanges", () => {
  it("pops the stash it created after the action succeeds", async () => {
    const restore = vi.fn(() => Promise.resolve());
    const action = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore,
      action,
    });

    expect(outcome).toEqual({ status: "done", leftInStash: false });
    expect(action).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith("abc123");
  });

  it("does not pop anything when there was nothing to stash", async () => {
    const restore = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve(null),
      restore,
      action: () => Promise.resolve(),
    });

    expect(outcome).toEqual({ status: "done", leftInStash: false });
    expect(restore).not.toHaveBeenCalled();
  });

  it("keeps the stash after success when popOnSuccess is false", async () => {
    const restore = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore,
      action: () => Promise.resolve(),
      popOnSuccess: false,
    });

    expect(outcome).toEqual({ status: "done", leftInStash: true });
    expect(restore).not.toHaveBeenCalled();
  });

  it("puts the changes back when the action fails, even with popOnSuccess false", async () => {
    const restore = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore,
      action: fail("would be overwritten"),
      popOnSuccess: false,
    });

    expect(outcome).toMatchObject({ status: "actionFailed", leftInStash: false });
    expect(restore).toHaveBeenCalledWith("abc123");
  });

  it("puts the changes back when the action fails", async () => {
    const restore = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore,
      action: fail("branch exists"),
    });

    expect(outcome).toMatchObject({ status: "actionFailed", leftInStash: false });
    expect(restore).toHaveBeenCalledWith("abc123");
  });

  it("reports changes left in the stash when putting them back also fails", async () => {
    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore: fail("conflict"),
      action: fail("branch exists"),
    });

    expect(outcome).toMatchObject({ status: "actionFailed", leftInStash: true });
  });

  it("neither runs the action nor pops when stashing fails", async () => {
    const restore = vi.fn(() => Promise.resolve());
    const action = vi.fn(() => Promise.resolve());

    const outcome = await runWithStashedChanges({
      stash: fail("merge in progress"),
      restore,
      action,
    });

    expect(outcome.status).toBe("stashFailed");
    expect(action).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("reports a failed pop after a successful action", async () => {
    const outcome = await runWithStashedChanges({
      stash: () => Promise.resolve("abc123"),
      restore: fail("conflict"),
      action: () => Promise.resolve(),
    });

    expect(outcome.status).toBe("restoreFailed");
  });
});
