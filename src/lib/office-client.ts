import type { OfficeCommand, OfficeSnapshot } from "../../shared/office";

const storageKey = () => `chief-office-session:${location.origin}`;
export const hasOfficeSession = () => Boolean(sessionStorage.getItem(storageKey()));
export class OfficeRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
// Deliberately independent of the private agent store. Member credentials are
// attached only to these office endpoints and never upgraded to owner access.
export async function officeRequest<T>(path = "", body?: unknown): Promise<T> {
  if (!["", "/claim", "/media", "/logout"].includes(path)) throw new Error("Invalid office endpoint");
  const token = sessionStorage.getItem(storageKey());
  const response = await fetch(`/api/office${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token && path !== "/claim" ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) throw new OfficeRequestError(result.error ?? "Office request failed", response.status);
  return result as T;
}
export async function claimOffice(code: string) {
  const result = await officeRequest<{ token: string; personId: string }>("/claim", { code });
  sessionStorage.setItem(storageKey(), result.token);
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}
export const updateOffice = (revision: number, command: OfficeCommand) =>
  officeRequest<OfficeSnapshot & { links: Array<{ personId: string; code: string }> }>("", { revision, command });

export async function officePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 15_000_000) throw new Error("Choose a photo smaller than 15 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable in this browser.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 320, 320);
    const data = canvas.toDataURL("image/jpeg", 0.82);
    if (data.length > 180_000) throw new Error("Photo is too detailed. Choose a smaller image.");
    return data;
  } finally { bitmap.close(); }
}
