import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
const blocks = new Set(["p", "div", "br", "li", "tr", "table", "blockquote", "h1", "h2", "h3", "h4", "pre"]);
function htmlText(node: HtmlNode): string {
  if ("value" in node) return node.value;
  if ("tagName" in node && ["script", "style", "template", "noscript"].includes(node.tagName)) return "";
  const content = "childNodes" in node ? node.childNodes.map(htmlText).join("") : "";
  if ("tagName" in node && node.tagName === "a") {
    const href = node.attrs.find(attribute => attribute.name === "href")?.value;
    // oxlint-disable-next-line no-control-regex -- Mail links must reject ASCII control characters.
    if (href && /^(?:https?:|mailto:)/i.test(href) && !/[\u0000-\u001f\u007f]/.test(href) && !content.includes(href)) return `${content} (${href})`;
  }
  return "tagName" in node && blocks.has(node.tagName) ? `${content}\n` : content;
}
export function mailHtmlToText(html: string): string {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error("Mail body exceeds the supported context size");
  return htmlText(parseFragment(html)).replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export interface ExtractedMailBody { text: string; available: boolean }
/** MIME alternatives are representations of one body, not extra messages.
 * A body held only in an un-fetched attachment is still incomplete. */
export function extractMailBody(input: unknown): ExtractedMailBody {
  const part = record(input);
  const body = record(part.body);
  const mime = String(part.mimeType ?? "text/plain").toLowerCase();
  if (["text/plain", "text/html"].includes(mime) && typeof body.data === "string") {
    if (body.data.length > 3_000_000 || !/^[a-zA-Z0-9_\-+/]*={0,2}$/.test(body.data)) throw new Error("Mail body encoding is invalid or excessive");
    const decoded = Buffer.from(body.data, "base64url").toString("utf8");
    return { text: mime === "text/html" ? mailHtmlToText(decoded) : decoded, available: true };
  }
  const children = Array.isArray(part.parts) ? part.parts : [];
  if (mime === "multipart/alternative") {
    const preferred = [...children.filter(value => record(value).mimeType === "text/plain"), ...children.filter(value => record(value).mimeType !== "text/plain")];
    for (const child of preferred) { const extracted = extractMailBody(child); if (extracted.available) return extracted; }
    return {text: "", available: false};
  }
  const contentParts = children.filter(value => /^(?:text\/(?:plain|html)|multipart\/)/i.test(String(record(value).mimeType ?? "text/plain")));
  const extracted = contentParts.map(extractMailBody);
  return { text: extracted.filter(body => body.available).map(body => body.text).join("\n"), available: extracted.length > 0 && extracted.every(body => body.available) };
}
