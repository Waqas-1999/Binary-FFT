import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog.tsx";
import { Dropdown } from "./dropdown.tsx";
import { Tabs } from "./tabs.tsx";
import { ToastProvider, useToast } from "./toast.tsx";

describe("Tabs", () => {
  const items = [
    { value: "a", label: "Profile", content: "Profile panel" },
    { value: "b", label: "Appearance", content: "Appearance panel" },
    { value: "c", label: "Security", content: "Security panel" },
  ];

  it("supports arrow, Home and End keys with a single tab stop", async () => {
    const user = userEvent.setup();
    render(<Tabs label="Sections" items={items} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);

    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Appearance" }).textContent).toBe("Appearance panel");

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tabs[2]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[0]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tabs[2]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tabs[0]);
  });
});

describe("Dropdown", () => {
  it("opens on click, moves focus with arrows, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <Dropdown
        label="Options"
        items={[
          { label: "Edit", onSelect: onEdit },
          { label: "Archive", onSelect: vi.fn(), disabled: true },
          { label: "Delete", onSelect: vi.fn(), danger: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Options" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Edit");

    await user.keyboard("{ArrowDown}"); // skips the disabled item
    expect(document.activeElement?.textContent).toBe("Delete");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Dialog", () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          title="Confirm"
          description="Are you sure?"
        />
      </>
    );
  }

  it("opens as a labelled modal and closes from the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Are you sure?");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast({ tone: "error", title: "Couldn't save", duration: 1000 })}>
        Save
      </button>
    );
  }

  it("announces errors as alerts and dismisses automatically", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.queryByRole("alert")).toBeNull();
    vi.useRealTimers();
  });
});
