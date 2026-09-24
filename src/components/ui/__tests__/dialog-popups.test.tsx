// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import type { BranchInfo } from "@/types";

afterEach(cleanup);

function Harness({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <Dialog onClose={() => setOpen(false)} ariaLabel="host">
      {children}
    </Dialog>
  ) : null;
}

describe("Escape inside a dialog", () => {
  it("closes an open Select without closing the dialog", () => {
    render(
      <Harness>
        <Select
          value="a"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onChange={() => {}}
        />
      </Harness>,
    );
    const trigger = screen.getByRole("button", { name: "Alpha" });
    fireEvent.click(trigger);
    expect(screen.getByText("Beta")).toBeTruthy();

    fireEvent.keyDown(screen.getByText("Beta"), { key: "Escape" });
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes an open BranchCombobox without closing the dialog", () => {
    const branches = [{ name: "main" }, { name: "dev" }] as BranchInfo[];
    render(
      <Harness>
        <BranchCombobox value="main" branches={branches} onChange={() => {}} />
      </Harness>,
    );
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "de" } });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
