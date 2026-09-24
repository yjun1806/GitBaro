// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import i18n from "@/i18n/config";
import { WorktreeBaseLabel } from "@/components/worktree/WorktreeBaseLabel";
import type { WorktreeBase } from "@/types";

afterEach(cleanup);
beforeAll(async () => {
  await i18n.changeLanguage("ko");
});

const base = (overrides: Partial<WorktreeBase> = {}): WorktreeBase => ({
  name: "dev",
  source: "reflog",
  aheadOfBase: 3,
  behindBase: 1,
  ...overrides,
});

describe("WorktreeBaseLabel", () => {
  it("shows the base branch with ahead and behind counts", () => {
    const { container } = render(<WorktreeBaseLabel base={base()} />);
    expect(container.textContent).toBe("dev에서 갈라짐· ↑3 ↓1");
    expect(container.textContent).not.toContain("추정");
  });

  it("hides zero counts", () => {
    const { container } = render(<WorktreeBaseLabel base={base({ aheadOfBase: 2, behindBase: 0 })} />);
    expect(container.textContent).toBe("dev에서 갈라짐· ↑2");
  });

  it("marks an inferred base and explains it in the tooltip", () => {
    const { container } = render(<WorktreeBaseLabel base={base({ source: "inferred" })} />);
    expect(container.textContent).toContain("추정");
    const title = container.firstElementChild?.getAttribute("title") ?? "";
    expect(title).toContain("가장 가까운 분기점으로 추정");
  });

  it("uses the short form without counts in the compact variant", () => {
    const { container } = render(<WorktreeBaseLabel base={base()} variant="compact" />);
    expect(container.textContent).toBe("dev 기반");
  });
});
