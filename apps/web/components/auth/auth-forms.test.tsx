import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests } from "../../lib/auth";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => resetAuthForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.replace.mockReset();
});

describe("SignupForm", () => {
  it("validates with the shared policy before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Create a password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(screen.getByText("Use at least 10 characters")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the user to check their email after signing up", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { status: "verification_pending" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText("Email"), "Alex@Example.com");
    await userEvent.type(screen.getByLabelText("Create a password"), "calm-river-sunrise-42");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/signup", expect.objectContaining({ method: "POST" }));
  });
});

describe("LoginForm", () => {
  it("shows a friendly generic error and never the backend message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { code: "INVALID_CREDENTIALS", message: "Invalid email or password" })),
    );
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That email and password don't match. Please try again.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("signs in and continues to the app", async () => {
    const user = { userNumber: 10000, email: "alex@example.com", emailVerified: true, googleConnected: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { user })));
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "calm-river-sunrise-42");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/trade"));
  });

  it("links to password recovery", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe("/forgot-password");
  });
});
