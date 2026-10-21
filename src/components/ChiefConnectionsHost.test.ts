import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ state: { pluginsOpen: false, appSettingsOpen: false, settingsOpen: false, bots: [{ id: "fixture" }], selectedId: "fixture" }, dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ api: vi.fn(), StoreProvider: () => { throw new Error("Must not mount before owner admission"); }, useStore: () => fixture }));
vi.mock("./PluginsPanel", () => ({ PluginsPanel: ({ refreshOnOpen }: { refreshOnOpen: boolean }) => createElement("div", null, `native apps refresh=${refreshOnOpen}`) }));
vi.mock("./SettingsModal", () => ({ SettingsModal: () => createElement("div", null, "native settings") }));
vi.mock("./BotSettingsDialog", () => ({ BotSettingsDialog: ({ bot }: { bot: { id: string } }) => createElement("div", null, `native bot ${bot.id}`) }));
import { ChiefConnectionsHost, ChiefConnectionModals, validChiefOwnerAdmission } from "./ChiefConnectionsHost";
beforeEach(() => Object.assign(fixture.state, { pluginsOpen: false, appSettingsOpen: false, settingsOpen: false }));
describe("Chief native connections host", () => {
  it.each([null, {}, { kind: "loopback" }, { name: "Chief shared workspace", enabled: true }, { name: "Other", enabled: true, available: true }])("rejects malformed admission %j", value => expect(validChiefOwnerAdmission(value)).toBe(false));
  it("admits owner response even when organization iframe is unavailable", () => expect(validChiefOwnerAdmission({ name: "Chief shared workspace", enabled: false, available: false })).toBe(true));
  it("never mounts the store or cached apps before owner admission", () => {
    const html = renderToStaticMarkup(createElement(ChiefConnectionsHost, { onClose: vi.fn() }));
    expect(html).toContain("Loading Chief connections");
    expect(html).not.toContain("native apps");
  });
  it("waits for native bots/config/instances hydration", () => {
    fixture.state.pluginsOpen = true;
    const html = renderToStaticMarkup(createElement(ChiefConnectionModals, { ready: false, onClose: vi.fn() }));
    expect(html).not.toContain("native apps");
  });
  it.each([
    ["pluginsOpen", "native apps refresh=true"],
    ["appSettingsOpen", "native settings"],
    ["settingsOpen", "native bot fixture"],
  ] as const)("hosts native %s transition", (key, expected) => {
    fixture.state[key] = true;
    expect(renderToStaticMarkup(createElement(ChiefConnectionModals, { ready: true, onClose: vi.fn() }))).toContain(expected);
  });
});
