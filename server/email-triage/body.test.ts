import { describe, expect, it } from "vitest";
import { extractMailBody, mailHtmlToText } from "./body.ts";
const encoded = (text: string) => Buffer.from(text).toString("base64url");
describe("complete mail body context", () => {
  it("reads HTML-only messages without executing or keeping script/style content", () => {
    const result = extractMailBody({mimeType:"text/html",body:{data:encoded('<style>hidden rule</style><script>never execute</script><p>Review &amp; approve Friday.</p><blockquote>Earlier promise</blockquote><a href="https://example.test/review">Review</a>')}});
    expect(result).toEqual({available:true,text:"Review & approve Friday.\nEarlier promise\nReview (https://example.test/review)"});
  });
  it("chooses plain text over its HTML alternative without duplicate obligations", () => {
    expect(extractMailBody({mimeType:"multipart/alternative",parts:[{mimeType:"text/html",body:{data:encoded('<p>Duplicate</p>')}},{mimeType:"text/plain",body:{data:encoded('Complete plain body')}}]})).toEqual({available:true,text:"Complete plain body"});
  });
  it("retains distinct mixed inline parts and empty complete bodies", () => {
    expect(extractMailBody({mimeType:"multipart/mixed",parts:[{mimeType:"text/plain",body:{data:encoded('First')}},{mimeType:"text/plain",body:{data:encoded('Second')}}]})).toEqual({available:true,text:"First\nSecond"});
    expect(extractMailBody({mimeType:"text/plain",body:{data:"",size:0}})).toEqual({available:true,text:""});
  });
  it("leaves snippet-only and unfetched body attachments incomplete", () => {
    expect(extractMailBody({snippet:"preview"}).available).toBe(false);
    expect(extractMailBody({mimeType:"text/html",body:{attachmentId:"large-body",size:1000}}).available).toBe(false);
    expect(extractMailBody({mimeType:"multipart/mixed",parts:[{mimeType:"text/plain",body:{data:encoded("Signature")}},{mimeType:"text/plain",body:{attachmentId:"missing-body"}}]}).available).toBe(false);
  });
  it("does not introduce executable links or treat hidden scripts as instructions", () => {
    expect(mailHtmlToText('<a href="javascript:alert(1)">Visible</a><template>Hidden instruction</template>')).toBe("Visible");
    expect(()=>extractMailBody({body:{data:"bad!encoding"}})).toThrow("encoding");
    expect(()=>mailHtmlToText("x".repeat(2_000_001))).toThrow("context size");
  });
});
