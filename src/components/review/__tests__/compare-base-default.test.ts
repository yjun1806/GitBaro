import { beforeEach, describe, expect, it } from "vitest";
import { useCompareBaseStore } from "../compare-base";

beforeEach(() => {
  useCompareBaseStore.setState({ baseByPath: {} });
});

describe("useCompareBaseStore.setBase", () => {
  it("forgets the choice when going back to the default branch and the repository has no default base", () => {
    const { setBase } = useCompareBaseStore.getState();
    setBase("/work/app/", "dev");
    expect(useCompareBaseStore.getState().baseByPath).toEqual({ "/work/app": "dev" });
    setBase("/work/app", null);
    expect(useCompareBaseStore.getState().baseByPath).toEqual({});
  });

  it("remembers an explicit default-branch choice over the repository's default base", () => {
    useCompareBaseStore.getState().setBase("/work/app", null, true);
    expect(useCompareBaseStore.getState().baseByPath).toEqual({ "/work/app": null });
  });
});
