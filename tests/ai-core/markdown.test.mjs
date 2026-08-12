import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdownTableDivider, parseInlineMarkdown, parseMarkdownTableRow } from "../../assets/site-assistant/markdown.mjs";

test("assistant Markdown recognizes emphasis, code, and safe web links", () => {
  assert.deepEqual(parseInlineMarkdown("Use **Client Portal**, *carefully*, with `Admin`, or [Support](https://n3xra.com/support)."), [
    { type: "text", value: "Use " },
    { type: "strong", value: "Client Portal" },
    { type: "text", value: ", " },
    { type: "emphasis", value: "carefully" },
    { type: "text", value: ", with " },
    { type: "code", value: "Admin" },
    { type: "text", value: ", or " },
    { type: "link", value: "Support", href: "https://n3xra.com/support" },
    { type: "text", value: "." },
  ]);
});

test("assistant Markdown never promotes HTML or unsafe links into markup tokens", () => {
  const tokens = parseInlineMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1))');
  assert.deepEqual(tokens, [{ type: "text", value: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' }]);
});

test("assistant Markdown recognizes a structured table without interpreting cell HTML", () => {
  assert.deepEqual(parseMarkdownTableRow("| Section | Why it matters |"), ["Section", "Why it matters"]);
  assert.equal(isMarkdownTableDivider("| --- | :---: |"), true);
  assert.equal(isMarkdownTableDivider("| <script> | --- |"), false);
});
