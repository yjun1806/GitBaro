// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { MaximizedOriginContext } from "@/components/layout/maximized-files";
import { DiffHeader } from "../DiffHeader";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ isDiffMaximized: false });
});
afterEach(() => {
  cleanup();
  useUIStore.setState({ isDiffMaximized: false });
});

function Header({ hasOrigin }: { hasOrigin: boolean }) {
  return (
    <MaximizedOriginContext.Provider value={hasOrigin}>
      <DiffHeader
        filePath="src/a.ts"
        status="modified"
        addedLines={0}
        removedLines={0}
        viewMode="unified"
        modes={["unified"]}
        onSelectMode={() => {}}
        maximizable
      />
    </MaximizedOriginContext.Provider>
  );
}

describe("DiffHeader maximize icon", () => {
  it("shows the maximize icon when not maximized, regardless of an origin header", () => {
    render(<Header hasOrigin />);
    expect(screen.getByRole("button", { name: /Maximize diff/ })).toBeTruthy();
  });

  it("shows the minimize icon while maximized when there is no origin header (no other way back)", () => {
    useUIStore.setState({ isDiffMaximized: true });
    render(<Header hasOrigin={false} />);
    expect(screen.getByRole("button", { name: "Restore size" })).toBeTruthy();
  });

  it("hides the minimize icon while maximized when an origin header is present (it owns the restore action)", () => {
    useUIStore.setState({ isDiffMaximized: true });
    render(<Header hasOrigin />);
    expect(screen.queryByRole("button", { name: "Restore size" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Maximize diff/ })).toBeNull();
  });
});
