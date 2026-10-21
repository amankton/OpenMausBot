import { useSyncExternalStore } from "react";
import type { LiveProvider, LiveSettings } from "../../shared/wire";

const KEY = "chief.liveProvider.v1";
export const LIVE_PROVIDERS = [{ id: "openai", label: "OpenAI GPT-Live" }, { id: "gemini", label: "Google Gemini Live" }] as const;
function read(): LiveProvider {
  try { return localStorage.getItem(KEY) === "gemini" ? "gemini" : "openai"; } catch { return "openai"; }
}
let current = read();
const listeners = new Set<() => void>();
export function setLiveProvider(provider: LiveProvider): void {
  current = provider;
  try { localStorage.setItem(KEY, provider); } catch { /* session-only preference */ }
  for (const listener of listeners) listener();
}
export function useLiveProvider(): LiveProvider {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => current);
}
export function liveProviderConfigured(settings: LiveSettings | undefined, provider: LiveProvider): boolean {
  return settings?.providers?.[provider]?.configured ?? (provider === "openai" && Boolean(settings?.configured));
}
export function providerDisclosure(provider: LiveProvider): string {
  return `Live audio and conversation context are sent to ${provider === "gemini" ? "Google" : "OpenAI"}. API usage is billed separately. Ending the call stops voice; agent tasks continue in chat.`;
}
