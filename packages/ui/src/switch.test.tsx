import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./switch.tsx";

function Harness({ initial = false, disabled = false }: { initial?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch label="Promotions" description="Offers and news." checked={checked} onCheckedChange={setChecked} disabled={disabled} />;
}

describe("Switch", () => {
  it("is a labelled switch with its description and a written state", () => {
    render(<Harness />);
    const control = screen.getByRole("switch", { name: "Promotions" });
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBe("Offers and news.");
    expect((control as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("toggles with the mouse and the keyboard, and writes the new state", async () => {
    render(<Harness />);
    const control = screen.getByRole("switch", { name: "Promotions" }) as HTMLInputElement;
    await userEvent.click(control);
    expect(control.checked).toBe(true);
    expect(screen.getByText("On")).toBeTruthy();

    control.focus();
    await userEvent.keyboard(" ");
    expect(control.checked).toBe(false);
  });

  it("reports changes, and ignores them when disabled", async () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch label="Required" checked onCheckedChange={onCheckedChange} disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Required" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);

    rerender(<Switch label="Required" checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
