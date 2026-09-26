// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { BusyIcon, Spinner } from "../Spinner";
import { LoadingState } from "../LoadingState";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("Spinner", () => {
  it("is hidden from screen readers when the text beside it says what is happening", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("[data-spinner]");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
  });

  it("reads as an image with its label when it stands alone", () => {
    render(<Spinner label="Fetching" />);
    const img = screen.getByRole("img", { name: "Fetching" });
    expect(img.getAttribute("aria-hidden")).toBeNull();
  });

  it("maps each size to one fixed box so sizes cannot drift", () => {
    const sizeOf = (size: "sm" | "md" | "lg") => {
      const { container } = render(<Spinner size={size} />);
      const cls = container.querySelector("[data-spinner]")?.getAttribute("class") ?? "";
      cleanup();
      return cls;
    };
    expect(sizeOf("sm")).toContain("w-3 h-3");
    expect(sizeOf("md")).toContain("w-3.5 h-3.5");
    expect(sizeOf("lg")).toContain("w-5 h-5");
  });

  it("defaults to the medium size and spins", () => {
    const { container } = render(<Spinner />);
    const cls = container.querySelector("[data-spinner]")?.getAttribute("class") ?? "";
    expect(cls).toContain("w-3.5 h-3.5");
    expect(cls).toContain("animate-spin");
  });
});

describe("BusyIcon", () => {
  it("shows the icon while idle and a spinner in its place while busy", () => {
    const icon = <span data-testid="icon" />;
    const { rerender, container } = render(<BusyIcon busy={false} icon={icon} />);
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(container.querySelector("[data-spinner]")).toBeNull();

    rerender(<BusyIcon busy icon={icon} />);
    expect(screen.queryByTestId("icon")).toBeNull();
    expect(container.querySelector("[data-spinner]")).not.toBeNull();
  });

  it("renders nothing while idle when there is no icon", () => {
    const { container } = render(<BusyIcon busy={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("LoadingState", () => {
  it("announces itself as a status with the default label", () => {
    render(<LoadingState />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading");
    expect(status.querySelector("[data-spinner]")).not.toBeNull();
  });

  it("uses the given label", () => {
    render(<LoadingState label="Loading diff..." />);
    expect(screen.getByRole("status").textContent).toBe("Loading diff...");
  });

  it("waits before appearing so short loads never flash", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status").className).toContain("animate-loading-in");
  });

  it("uses a medium spinner in a panel and a small one in a row", () => {
    const { container, rerender } = render(<LoadingState />);
    expect(container.querySelector("[data-spinner]")?.getAttribute("class")).toContain("w-3.5 h-3.5");
    expect(screen.getByRole("status").getAttribute("data-loading-state")).toBe("panel");

    rerender(<LoadingState layout="row" />);
    expect(container.querySelector("[data-spinner]")?.getAttribute("class")).toContain("w-3 h-3");
    expect(screen.getByRole("status").getAttribute("data-loading-state")).toBe("row");
  });
});
