import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.tsx";
import { IconButton } from "./icon-button.tsx";

describe("Button", () => {
  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Continue</Button>);
    expect(screen.getByRole("button", { name: "Continue" }).getAttribute("type")).toBe("button");
  });

  it("calls onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks clicks when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Continue
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("announces loading, blocks repeat clicks and keeps the label for width", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Continue
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Continue/ });

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Loading");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides decorative icons from assistive technology", () => {
    render(<Button icon={<svg data-testid="icon" />}>Continue</Button>);
    expect(screen.getByTestId("icon").parentElement?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("IconButton", () => {
  it("uses the required label as its accessible name", () => {
    render(<IconButton label="Close" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});
