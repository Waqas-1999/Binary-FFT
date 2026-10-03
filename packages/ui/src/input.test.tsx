import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Input, Select } from "./input.tsx";
import { NumberInput } from "./number-input.tsx";
import { PasswordInput } from "./password-input.tsx";
import { SearchInput } from "./search-input.tsx";

describe("Input", () => {
  it("is labelled by its visible label, not a placeholder", () => {
    render(<Input label="Email" placeholder="you@example.com" />);
    expect(screen.getByLabelText("Email").getAttribute("placeholder")).toBe("you@example.com");
  });

  it("links the hint as its description", () => {
    render(<Input label="Email" hint="We never share it." />);
    const input = screen.getByLabelText("Email");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("We never share it.");
  });

  it("marks errors as invalid and describes them, replacing the hint", () => {
    render(<Input label="Email" hint="We never share it." error="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a valid email.");
    expect(screen.queryByText("We never share it.")).toBeNull();
  });

  it("supports disabled and loading states", () => {
    render(<Input label="Code" disabled loading />);
    const input = screen.getByLabelText("Code") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading");
  });
});

describe("Select", () => {
  it("renders a labelled native select with a placeholder option", () => {
    render(<Select label="Country" placeholder="Choose…" options={[{ value: "pk", label: "Pakistan" }]} />);
    const select = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Pakistan" })).toBeTruthy();
  });
});

describe("PasswordInput", () => {
  it("toggles visibility with an accessible, stateful button", async () => {
    render(<PasswordInput label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("type")).toBe("password");

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("NumberInput", () => {
  it("accepts only numeric text", async () => {
    const onValueChange = vi.fn();
    render(<NumberInput label="Amount" min={0} onValueChange={onValueChange} />);
    const input = screen.getByLabelText("Amount") as HTMLInputElement;

    await userEvent.type(input, "1a2.5e");
    expect(input.value).toBe("12.5");
    expect(onValueChange).toHaveBeenLastCalledWith("12.5");
  });

  it("steps within min/max and disables the button at the limit", async () => {
    render(<NumberInput label="Amount" defaultValue="9" min={0} max={10} step={1} stepper />);
    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    const increase = screen.getByRole("button", { name: "Increase Amount" }) as HTMLButtonElement;

    await userEvent.click(increase);
    expect(input.value).toBe("10");
    expect(increase.disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Decrease Amount" }));
    expect(input.value).toBe("9");
  });
});

describe("SearchInput", () => {
  it("shows a clear button only when there is text, and refocuses after clearing", async () => {
    render(<SearchInput label="Search assets" />);
    const input = screen.getByRole("searchbox", { name: "Search assets" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    await userEvent.type(input, "gold");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });
});
