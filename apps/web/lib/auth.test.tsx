import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logout, resetAuthForTests, useAuth } from "./auth";
import { safeRedirectPath } from "./routes";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Status() {
  const auth = useAuth();
  return <p>{auth.status === "authenticated" ? `signed in as ${auth.user.userNumber}` : auth.status}</p>;
}

const user = { userNumber: 10000, email: "alex@example.com", emailVerified: true };

beforeEach(() => resetAuthForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAuth", () => {
  it("goes from loading to authenticated with a valid session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Status />);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("signed in as 10000")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/session", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("goes from loading to unauthenticated without a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" })));
    render(<Status />);
    expect(await screen.findByText("unauthenticated")).toBeTruthy();
  });

  it("checks the session once for many components", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <Status />
        <Status />
      </>,
    );
    expect(await screen.findAllByText("signed in as 10000")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("becomes unauthenticated after logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse(200, { user })).mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    render(<Status />);
    await screen.findByText("signed in as 10000");
    await act(() => logout());
    expect(screen.getByText("unauthenticated")).toBeTruthy();
  });
});

describe("safeRedirectPath", () => {
  it("allows same-site paths and rejects open redirects", () => {
    expect(safeRedirectPath("/profile")).toBe("/profile");
    expect(safeRedirectPath(null)).toBe("/trade");
    for (const unsafe of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(safeRedirectPath(unsafe)).toBe("/trade");
    }
  });
});
