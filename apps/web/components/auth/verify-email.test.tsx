import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyEmail } from "./verify-email";

const verificationToken = "A".repeat(43);
const user = { userNumber: 10000, email: "alex@example.com", emailVerified: true, googleConnected: false };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setVerificationFragment(token: string): void {
  window.history.replaceState(null, "", `/verify-email#token=${token}`);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/verify-email");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/verify-email");
});

describe("VerifyEmail", () => {
  it("automatically verifies a valid fragment token and does not request another email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user }));
    vi.stubGlobal("fetch", fetchMock);
    setVerificationFragment(verificationToken);

    render(
      <StrictMode>
        <VerifyEmail />
      </StrictMode>,
    );

    expect(await screen.findByRole("heading", { name: "Your email is verified" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/verify-email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: verificationToken }),
      }),
    );
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/auth/verification/resend")).toBe(false);
    expect(window.location.hash).toBe("");
    expect(document.body.textContent).not.toContain(verificationToken);
  });

  it("shows an expired-or-used message and a manual resend option for an invalid token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { code: "VERIFICATION_LINK_INVALID" }));
    vi.stubGlobal("fetch", fetchMock);
    setVerificationFragment(verificationToken);

    render(<VerifyEmail />);

    expect(await screen.findByRole("heading", { name: "This link no longer works" })).toBeTruthy();
    expect(screen.getByText(/expired or already been used/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/auth/verification/resend")).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("rejects a malformed fragment token without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setVerificationFragment("not-a-valid-token");

    render(<VerifyEmail />);

    expect(await screen.findByRole("heading", { name: "This link no longer works" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("shows a network failure without exposing the token", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    setVerificationFragment(verificationToken);

    render(<VerifyEmail />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Can't connect right now. Check your internet connection and try again.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("");
    expect(document.body.textContent).not.toContain(verificationToken);
  });

  it("keeps the manual resend fallback when there is no fragment token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { status: "verification_pending" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmail />);

    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send a new link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/verification/resend",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "alex@example.com" }),
      }),
    );
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
