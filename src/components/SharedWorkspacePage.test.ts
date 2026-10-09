import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { sharedWorkspaceUrl, sharedWorkspacePermissions, SharedWorkspaceSurface, type SharedWorkspaceStatus } from "./SharedWorkspacePage";

const chiefOrigin = "http://127.0.0.1:5299";
const ready: SharedWorkspaceStatus = { enabled: true, available: true, name: "Chief shared workspace", url: "http://localhost:18087/workbench/fixture/contact/persons" };
const render = (status: SharedWorkspaceStatus | null, extra: { error?: string; loading?: boolean } = {}) =>
  renderToStaticMarkup(createElement(SharedWorkspaceSurface, { status, error: "", loading: false, origin: chiefOrigin, onRetry: vi.fn(), ...extra }));
afterEach(() => vi.unstubAllGlobals());

describe("shared workspace origin boundary", () => {
  it.each([
    "http://localhost:18087/", "http://localhost:18087/workbench/fixture/contact/persons",
  ])("accepts configured separate loopback service %s", value => {
    expect(sharedWorkspaceUrl(value, chiefOrigin)).toBe(value);
  });

  it.each([
    "http://127.0.0.1:5299/", "http://127.0.0.1:18087/", "https://localhost:18087/", "http://example.test/", "http://localhost.example.test/",
    "http://localhost@evil.test/", "http://user:password@localhost:18087/", "http://127.1:18087/",
    "http://2130706433:18087/", "//127.0.0.1:18087/", "javascript:alert(1)", "data:text/html,test",
    "http://localhost:18087/?token=fixture-secret", "http://localhost:18087/#token=fixture-secret",
    "http://localhost:18087/\\evil.test", "http://localhost:99999/", " /workspace", undefined,
  ])("rejects unsafe or session-bearing address %s", value => {
    expect(sharedWorkspaceUrl(value, chiefOrigin)).toBeNull();
  });

  it("retains the actual configured workbench with restricted frame authority", () => {
    const html = render(ready);
    expect(html).toContain(`src="${ready.url}"`);
    expect(html).toContain('title="Chief organization workspace"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"');
    expect(html).not.toContain("allow-top-navigation");
    expect(html).not.toContain("allow-popups");
    for (const capability of ["camera", "microphone", "display-capture", "local-network", "loopback-network"]) {
      expect(html).toContain(`${capability} http://localhost:18087`);
    }
    for (const capability of ["clipboard-read", "clipboard-write", "geolocation"]) {
      expect(html).toContain(`${capability} &#x27;none&#x27;`);
    }
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("target=");
    expect(html).toContain(`href="${ready.url}" rel="noreferrer"`);
    expect(html).toContain('href="/"');
  });

  it("scopes delegated features to the validated origin, never paths or wildcards", () => {
    const policy = sharedWorkspacePermissions(ready.url!, chiefOrigin);
    expect(policy).not.toMatch(/\*|workbench|fixture/);
    expect(policy.split("; ").filter(entry => !entry.endsWith("'none'"))).toEqual(
      ["camera", "microphone", "display-capture", "local-network", "loopback-network"].map(feature => `${feature} http://localhost:18087`),
    );
    for (const unsafe of ["https://evil.test/", chiefOrigin, "http://localhost:18087/?token=secret"]) {
      expect(sharedWorkspacePermissions(unsafe, chiefOrigin).split("; ").every(entry => entry.endsWith("'none'"))).toBe(true);
    }
  });

  it("keeps the ready frame mounted while an availability retry is pending", () => {
    const html = render(ready, { loading: true });
    expect(html).toContain(`src="${ready.url}"`);
    expect(html).not.toContain("Connecting to your shared workspace");
    expect(html).toContain("Camera and microphone stay off until you turn them on.");
  });

  it("keeps host-scoped cookies isolated when Chief is opened through localhost", () => {
    expect(sharedWorkspaceUrl("http://localhost:18087/", "http://localhost:5299")).toBeNull();
    expect(sharedWorkspaceUrl("http://127.0.0.1:18087/", "http://localhost:5299")).toBe("http://127.0.0.1:18087/");
  });

  it("does not propagate host URL credentials or office sessions", () => {
    vi.stubGlobal("location", { origin: chiefOrigin, search: "?token=host-secret", hash: "#invite=office-secret" });
    vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => "member-secret") });
    const html = render(ready);
    expect(html).not.toMatch(/host-secret|office-secret|member-secret/);
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
  });

  it.each([
    { ...ready, enabled: false }, { ...ready, available: false }, { ...ready, url: "https://evil.test/" },
  ])("does not mount an unavailable or invalid retained service", status => {
    const html = render(status);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('target="chief-retained-workspace"');
    expect(html).toContain("Shared workspace is not available yet");
    expect(html).toContain(">Retry</button>");
  });

  it("shows configuration and request failures without invented Contacts content", () => {
    const html = render({ ...ready, available: false, message: "Independent service has not started." });
    expect(html).toContain("Independent service has not started.");
    expect(html).not.toContain("<iframe");
    const failed = render(null, { error: "Owner session required" });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Owner session required");
    expect(render(null, { loading: true })).toContain("Connecting to your shared workspace");
  });
});
