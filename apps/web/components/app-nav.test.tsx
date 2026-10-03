import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isActivePath } from "../lib/routes";
import { BottomNav, TopNav } from "./app-nav";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

afterEach(cleanup);

describe("isActivePath", () => {
  it("matches the page and its sub-pages, but not similar prefixes", () => {
    expect(isActivePath("/wallet", "/wallet")).toBe(true);
    expect(isActivePath("/wallet/deposit", "/wallet")).toBe(true);
    expect(isActivePath("/wallets", "/wallet")).toBe(false);
    expect(isActivePath("/trade", "/")).toBe(false);
  });
});

describe.each([
  ["BottomNav", BottomNav],
  ["TopNav", TopNav],
])("%s", (_, Nav) => {
  it("lists the four destinations in order with text labels", () => {
    render(<Nav />);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Trade", "Activity", "Wallet", "Profile"]);
  });

  it("marks only the current destination with aria-current", () => {
    navigation.pathname = "/profile";
    render(<Nav />);
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Profile"]);
  });
});
