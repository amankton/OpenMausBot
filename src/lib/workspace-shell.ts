/** Presentation-only messages. This bridge never carries identity or navigation. */
export const WORKSPACE_HELLO = "chief:workspace:hello";
export const WORKSPACE_SLOT = "chief:workspace:slot";
export const WORKSPACE_READY = "chief:workspace:ready";
export interface WorkspaceSlot { x: number; y: number; width: number; height: number }

export function workspaceSlot(value: unknown, viewportWidth: number): WorkspaceSlot | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as WorkspaceSlot;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || x > 32 || y < 0 || y > 24 ||
      width < 88 || width > 160 || height < 24 || height > 48 || x + width > viewportWidth) return null;
  return { x, y, width, height };
}
