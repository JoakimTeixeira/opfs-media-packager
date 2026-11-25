import test from "node:test";
import assert from "node:assert/strict";
import { boundedText, safeMediaUrl, validTabId } from "../../lib/security.ts";

test("should allow only bounded, credential-free remote HTTP(S) media URLs", () => {
  assert.equal(
    safeMediaUrl("https://cdn.example/video.m3u8?token=abc"),
    "https://cdn.example/video.m3u8?token=abc",
  );

  assert.equal(
    safeMediaUrl("http://cdn.example/video.m3u8"),
    "http://cdn.example/video.m3u8",
  );

  assert.equal(
    safeMediaUrl("https://user:secret@cdn.example/video.m3u8"),
    null,
  );

  assert.equal(safeMediaUrl("file:///C:/secret.m3u8"), null);
  assert.equal(safeMediaUrl(new URL("https://cdn.example/video.m3u8")), null);
  assert.equal(safeMediaUrl("https://user@cdn.example/video.m3u8"), null);
  assert.equal(safeMediaUrl("https://:secret@cdn.example/video.m3u8"), null);
});

test("should refuse local-network, malformed, and oversized URLs", () => {
  for (const url of [
    "http://localhost/video.m3u8",
    "http://[::1]/video.m3u8",
    "http://127.0.0.1/video.m3u8",
    "http://10.0.0.1/video.m3u8",
    "http://172.16.0.1/video.m3u8",
    "http://192.168.1.1/video.m3u8",
    "http://172.20.0.1/video.m3u8",
    "https://host.local/video.m3u8",
    "not a url",
    "https://",
    `https://example.com/${"x".repeat(8192)}`,
  ]) {
    assert.equal(safeMediaUrl(url), null);
  }
});

test("should enforce exact scheme syntax and keep the maximum accepted URL bounded", () => {
  assert.equal(safeMediaUrl("https:/cdn.example/video.m3u8"), null);
  assert.equal(safeMediaUrl("httpsx://cdn.example/video.m3u8"), null);

  assert.equal(
    safeMediaUrl(`https://cdn.example/${"x".repeat(8168)}`)?.startsWith(
      "https://cdn.example/",
    ),
    true,
  );

  const exactlyMaximum = `https://x/${"a".repeat(8182)}`;

  assert.equal(exactlyMaximum.length, 8192);
  assert.equal(safeMediaUrl(exactlyMaximum), exactlyMaximum);

  assert.equal(
    safeMediaUrl("http://172.32.0.1/video.m3u8"),
    "http://172.32.0.1/video.m3u8",
  );
});

test("should bound page-provided text and accept only non-negative safe tab IDs", () => {
  assert.equal(boundedText("abcdef", 3), "abc");
  assert.equal(boundedText(null, 3), "");
  assert.equal(validTabId(0), true);
  assert.equal(validTabId(-1), false);
  assert.equal(validTabId(1.5), false);
});
