// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LineDelta } from "../marks";

afterEach(cleanup);

describe("LineDelta (3.15: every +/− display)", () => {
  it("shows both sides when both changed", () => {
    const { container } = render(<LineDelta additions={12} deletions={4} />);
    expect(container.textContent).toBe("+12−4");
  });

  it("drops the side that is zero or unknown", () => {
    expect(render(<LineDelta additions={7} deletions={0} />).container.textContent).toBe("+7");
    cleanup();
    expect(render(<LineDelta additions={null} deletions={3} />).container.textContent).toBe("−3");
  });

  it("draws nothing when neither side changed", () => {
    expect(render(<LineDelta additions={0} deletions={0} />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<LineDelta additions={undefined} deletions={null} />).container.innerHTML).toBe("");
  });
});
