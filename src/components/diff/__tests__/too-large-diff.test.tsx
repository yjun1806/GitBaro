// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useFileDiff } from "@/api/queries";
import { useDiffForceStore } from "@/stores/diff-force";
import { useUIStore } from "@/stores/ui";
import { DiffViewer } from "../DiffViewer";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const tooLarge = {
  filePath: "big.log",
  staged: false,
  binary: true,
  binaryPreview: { meta: { fileType: "other", mimeType: "x", oldSize: null, newSize: 9_000_000, tooLarge: true } },
  insertions: 0,
  deletions: 0,
  hunks: [],
  oldContent: "",
  newContent: "",
};
const full = {
  ...tooLarge,
  binary: false,
  binaryPreview: null,
  insertions: 1,
  hunks: [
    { header: "@@ -0,0 +1 @@", oldStart: 0, newStart: 1, lines: [{ kind: "addition", content: "hello", oldLineNo: null, newLineNo: 1 }] },
  ],
  newContent: "hello\n",
};

function Probe() {
  const { data } = useFileDiff("/r", "big.log", false);
  return <DiffViewer diff={data ?? null} />;
}

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  await i18n.changeLanguage("en");
  useUIStore.setState({ theme: "light" });
  useDiffForceStore.setState({ forced: new Set() });
  invoke.mockReset();
  invoke.mockImplementation(async (_cmd: string, args: { force?: boolean }) => (args.force ? full : tooLarge));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("too-large working diff", () => {
  it("shows the notice, and Show anyway refetches with force", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await screen.findByText(/too large/i);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1]).toMatchObject({ force: false });

    fireEvent.click(screen.getByRole("button", { name: "Show anyway" }));

    // 새 키로 읽는 동안은 diff가 없다. 읽고 나면 안내 없이 diff가 그려진다.
    await waitFor(() => expect(screen.queryByText("Select a file to view changes")).toBeNull());
    expect(screen.queryByText(/too large/i)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toMatchObject({ filePath: "big.log", force: true });
    expect(screen.queryByRole("button", { name: "Show anyway" })).toBeNull();
  });
});
