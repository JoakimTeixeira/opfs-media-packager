import test from "node:test";
import assert from "node:assert/strict";
import { isDirectVideoUrl, streamIdentity } from "../lib/stream-identity.ts";

test("should give a master manifest and its renditions one stream identity", () => {
  const master = "https://media.example.net/lesson/master.m3u8";
  const rendition = "https://media.example.net/lesson/720p/video.m3u8";

  assert.equal(streamIdentity(master), "https://media.example.net/lesson/");
  assert.equal(streamIdentity(rendition), streamIdentity(master));
});

test("should preserve distinct named playlists and reject malformed URLs", () => {
  assert.equal(
    streamIdentity("https://cdn.example/show/playlist_2.m3u8?token=1"),
    "https://cdn.example/show/playlist",
  );

  assert.equal(streamIdentity("not a URL"), null);
});

test("should give signed requests for one asset a stable identity", () => {
  const asset = "22222222-2222-4222-8222-222222222222";
  const first = `https://signed-media.example/token=first&path=%2F${asset}%2F&expires=1/${asset}/hls/playlist.m3u8`;
  const renewed = `https://signed-media.example/token=renewed&path=%2F${asset}%2F&expires=2/${asset}/hls/1080p/playlist.m3u8`;

  assert.equal(
    streamIdentity(first),
    "https://signed-media.example/signed-hls/22222222-2222-4222-8222-222222222222",
  );

  assert.equal(streamIdentity(renewed), streamIdentity(first));

  assert.equal(
    streamIdentity("https://signed-media.example/other/playlist.m3u8"),
    "https://signed-media.example/other/",
  );
});

test("should detect direct video file URLs across mp4, m4v, webm, and mov while rejecting non-video or invalid URLs", () => {
  assert.equal(
    isDirectVideoUrl("https://assets.example.net/recording-1.mp4"),
    true,
  );

  assert.equal(isDirectVideoUrl("http://cdn.example/clip.M4V?token=1"), true);

  assert.equal(isDirectVideoUrl("https://cdn.example/demo.webm"), true);
  assert.equal(isDirectVideoUrl("https://cdn.example/demo.mov"), true);
  assert.equal(isDirectVideoUrl("https://cdn.example/playlist.m3u8"), false);
  assert.equal(isDirectVideoUrl("https://cdn.example/pic.png"), false);
  assert.equal(isDirectVideoUrl("ftp://cdn.example/video.mp4"), false);
  assert.equal(isDirectVideoUrl("not a url"), false);
});
