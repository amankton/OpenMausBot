import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimOffice, hasOfficeSession, officeRequest } from "./office-client";

describe("office member credential boundary", () => {
  let saved: Map<string, string>;
  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("location", { origin: "http://127.0.0.1:5299", pathname: "/office", search: "", hash: "#invite=fixture" });
    vi.stubGlobal("history", { replaceState: vi.fn() });
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("claims only on explicit call, stores per-origin session and removes the one-use fragment", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-member-token", personId: "person-1" })));
    vi.stubGlobal("fetch", fetcher);
    expect(hasOfficeSession()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await claimOffice("fixture-link");
    expect(hasOfficeSession()).toBe(true);
    expect(saved.get("chief-office-session:http://127.0.0.1:5299")).toBe("test-member-token");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/office");
    expect(fetcher.mock.calls[0][0]).toBe("/api/office/claim");
    expect(fetcher.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it("never retries rejected member access as loopback owner", async () => {
    saved.set("chief-office-session:http://127.0.0.1:5299", "expired-member-token");
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Expired" }), { status: 401 })));
    vi.stubGlobal("fetch", fetcher);
    await expect(officeRequest()).rejects.toMatchObject({ status: 401 });
    await expect(officeRequest()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) expect(call[1].headers.authorization).toBe("Bearer expired-member-token");
    expect(hasOfficeSession()).toBe(true);
  });

  it("cannot attach a member credential to private agent routes or arbitrary URLs", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    saved.set("chief-office-session:http://127.0.0.1:5299", "test-member-token");
    for (const path of ["/api/bots", "../bots", "https://example.test", "/media?token=leak"]) {
      await expect(officeRequest(path)).rejects.toThrow("Invalid office endpoint");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains the prior session and invitation fragment when claiming fails", async () => {
    saved.set("chief-office-session:http://127.0.0.1:5299", "existing-member-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Already used" }), { status: 401 })));
    await expect(claimOffice("used-link")).rejects.toThrow("Already used");
    expect(saved.get("chief-office-session:http://127.0.0.1:5299")).toBe("existing-member-token");
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
