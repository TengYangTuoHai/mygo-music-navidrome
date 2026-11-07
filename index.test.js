import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as plugin from "./index.js";

const settings = { server: "https://music.example.com/navidrome/", username: "alice", password: "secret" };
const calls = [];
let reply;
globalThis.host = { setting: key => settings[key], crypto: { md5: text => createHash("md5").update(text).digest("hex") } };
globalThis.fetch = async input => {
  const url = new URL(input);
  calls.push(url);
  const body = await reply(url.pathname.split("/").pop(), url.searchParams);
  return { ok: true, json: async () => ({ "subsonic-response": body }) };
};
beforeEach(() => { calls.length = 0; settings.server = "https://music.example.com/navidrome/"; reply = () => ({ status: "ok" }); });

test("search signs requests, preserves subpath, and paginates", async () => {
  reply = () => ({ status: "ok", searchResult3: { song: Array.from({ length: 51 }, (_, i) => ({ id: i, title: `Song ${i}`, duration: 3 })) } });
  const result = await plugin.search({ query: "你好 & music", kind: "tracks", offset: 50 });
  assert.equal(result.tracks.length, 50);
  assert.equal(result.tracks[0].duration, 3000);
  assert.equal(result.more, true);
  const url = calls[0];
  assert.equal(url.pathname, "/navidrome/rest/search3");
  assert.equal(url.searchParams.get("query"), "你好 & music");
  assert.equal(url.searchParams.get("songOffset"), "50");
  assert.equal(url.searchParams.get("albumCount"), "0");
  assert.equal(url.searchParams.get("t"), createHash("md5").update("secret" + url.searchParams.get("s")).digest("hex"));
  assert.equal(url.searchParams.has("p"), false);
});

test("stream preserves supported formats and asks server to transcode others", async () => {
  reply = () => ({ status: "ok", song: { id: "1", suffix: "flac" } });
  let stream = await plugin.stream({ id: "1" });
  assert.equal(stream.type, "flac");
  assert.equal(new URL(stream.url).searchParams.get("format"), "raw");
  reply = () => ({ status: "ok", song: { id: "1", suffix: "opus" } });
  stream = await plugin.stream({ id: "1" });
  assert.equal(stream.type, "mp3");
  assert.equal(new URL(stream.url).searchParams.get("format"), "mp3");
});

test("playlist removal sends descending indices, including duplicate tracks", async () => {
  reply = method => method === "getPlaylist" ? { status: "ok", playlist: { entry: [{ id: "a" }, { id: "b" }, { id: "a" }] } } : { status: "ok" };
  await plugin.removeFromPlaylist({ id: "p", trackIds: ["a"] });
  assert.deepEqual(calls[1].searchParams.getAll("songIndexToRemove"), ["2", "0"]);
});

test("favorites paginate and lookup IDs", async () => {
  reply = () => ({ status: "ok", starred2: { song: Array.from({ length: 51 }, (_, id) => ({ id, title: "A" })) } });
  const page = await plugin.liked({ offset: 50 });
  assert.equal(page.tracks.length, 1);
  assert.equal(page.more, false);
  assert.deepEqual(await plugin.isLiked({ ids: ["0", "missing"] }), { "0": true, missing: false });
});

test("structured lyrics preserve timestamps and offset", async () => {
  reply = () => ({ status: "ok", lyricsList: { structuredLyrics: [{ synced: true, offset: -100, line: [{ start: 1500, value: "hello" }] }] } });
  assert.equal((await plugin.lyrics({ id: "1" })).lrc, "[00:01.400]hello");
});

test("configuration and API errors are surfaced", async () => {
  settings.server = "ftp://example.com";
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup" });
  settings.server = "https://music.example.com";
  reply = () => ({ status: "failed", error: { code: 40, message: "Wrong username or password" } });
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup", message: "Wrong username or password" });
});
