// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlertTriangle, FileText } from "lucide-react";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";

afterEach(cleanup);

describe("Notice", () => {
  it("uses role=alert for danger and role=status otherwise", () => {
    const { rerender } = render(<Notice tone="danger">Something failed</Notice>);
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(<Notice tone="info">Just so you know</Notice>);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders a title, description and actions when given", () => {
    render(
      <Notice tone="warning" icon={AlertTriangle} title="Force push" actions={<button>Cancel</button>}>
        This rewrites history on the remote.
      </Notice>,
    );
    expect(screen.getByText("Force push")).toBeTruthy();
    expect(screen.getByText("This rewrites history on the remote.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders the panel layout with a title, description and icon", () => {
    const { container } = render(
      <EmptyState icon={FileText} title="No file selected" description="Pick a file to see its diff" />,
    );
    expect(screen.getByText("No file selected")).toBeTruthy();
    expect(screen.getByText("Pick a file to see its diff")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders just one line of text for the row layout", () => {
    const { container } = render(<EmptyState layout="row" title="No matches" />);
    expect(container.querySelector("p")?.textContent).toBe("No matches");
  });
});
