import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as plugin from "./index.js";

const settings = { server: "https://music.example.com/navidrome/", username: "alice", password: "secret" };
const calls = [];
let reply;
let nativeReply;
globalThis.host = { setting: key => settings[key], crypto: { md5: text => createHash("md5").update(text).digest("hex") } };
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  calls.push(url);
  if (url.pathname.includes("/auth/") || url.pathname.includes("/api/")) {
    return nativeReply(url, options);
  }
  const body = await reply(url.pathname.split("/").pop(), url.searchParams);
  return { ok: true, json: async () => ({ "subsonic-response": body }) };
};
beforeEach(() => {
  calls.length = 0;
  settings.server = "https://music.example.com/navidrome/";
  reply = () => ({ status: "ok" });
  nativeReply = () => ({ ok: false, status: 404 });
});

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

test("stream requests the selected quality and a matching decoder format", async () => {
  reply = () => ({ status: "ok", song: { id: "1", suffix: "flac" } });
  for (const [quality, bitrate] of [["standard", "128"], ["high", "320"], [undefined, "320"]]) {
    const stream = await plugin.stream({ id: "1", quality });
    const params = new URL(stream.url).searchParams;
    assert.equal(stream.type, "mp3");
    assert.equal(params.get("format"), "mp3");
    assert.equal(params.get("maxBitRate"), bitrate);
    assert.notEqual(stream.quality, "lossless");
  }
  const raw = await plugin.stream({ id: "1", quality: "lossless" });
  assert.equal(raw.type, "flac");
  assert.equal(new URL(raw.url).searchParams.get("format"), "raw");
  assert.equal(new URL(raw.url).searchParams.has("maxBitRate"), false);
  reply = () => ({ status: "ok", song: { id: "1", suffix: "opus" } });
  const fallback = await plugin.stream({ id: "1", quality: "lossless" });
  assert.equal(fallback.type, "mp3");
  assert.equal(new URL(fallback.url).searchParams.get("format"), "mp3");
  assert.equal(new URL(fallback.url).searchParams.get("maxBitRate"), "320");
  assert.notEqual(fallback.quality, "lossless");
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

test("browse lists starred and indexed artists", async () => {
  reply = method => method === "getStarred2"
    ? { status: "ok", starred2: { artist: [{ id: "a", name: "Artist", starred: "2026-01-01" }] } }
    : { status: "ok", artists: { index: [{ name: "A", artist: [{ id: "a", name: "Artist" }] }, { name: "B", artist: [{ id: "b", name: "Band" }] }] } };
  const liked = await plugin.browse({ page: "liked-artists" });
  assert.equal(liked.sections[0].artists[0].following, true);
  const all = await plugin.browse({ page: "artists" });
  assert.deepEqual(all.sections[0].artists.map(artist => artist.id), ["a", "b"]);
});

test("artist browsing uses Navidrome native API with authenticated pagination", async () => {
  settings.server = "https://native.example.com/base";
  const requests = [];
  nativeReply = (url, options) => {
    requests.push({ url, options });
    if (url.pathname.endsWith("/auth/login")) return { ok: true, status: 200, json: async () => ({ token: "jwt" }) };
    const offset = Number(url.searchParams.get("_start"));
    const page = offset === 0 ? Array.from({ length: 500 }, (_, id) => ({ id: String(id), name: "Artist" })) : [{ id: "last", name: "Last" }];
    return { ok: true, status: 200, json: async () => page };
  };
  const result = await plugin.browse({ page: "artists" });
  assert.equal(result.sections[0].artists.length, 501);
  assert.equal(requests[0].url.pathname, "/base/auth/login");
  assert.deepEqual(JSON.parse(requests[0].options.body), { username: "alice", password: "secret" });
  assert.equal(requests[1].options.headers["X-ND-Authorization"], "Bearer jwt");
  assert.equal(requests[2].url.searchParams.get("_start"), "500");
  assert.equal(new URL(result.sections[0].artists[0].imageUrl).searchParams.get("id"), "ar-0");
});

test("album browsing links pages without dropping albums", async () => {
  reply = (_method, params) => ({ status: "ok", albumList2: { album: Array.from({ length: params.get("offset") === "0" ? 51 : 1 }, (_, i) => ({ id: String(i + Number(params.get("offset"))), name: "Album" })) } });
  const first = await plugin.browse({ page: "albums" });
  assert.equal(first.sections[0].albums.length, 50);
  assert.equal(first.sections[1].links[0].page, "albums:50");
  const second = await plugin.browse({ page: first.sections[1].links[0].page });
  assert.equal(second.sections[0].albums[0].id, "50");
  assert.equal(second.sections[1].links[0].page, "albums");
  assert.equal(second.sections[1].links.length, 1);
});

test("configuration and API errors are surfaced", async () => {
  settings.server = "ftp://example.com";
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup" });
  settings.server = "https://music.example.com";
  reply = () => ({ status: "failed", error: { code: 40, message: "Wrong username or password" } });
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup", message: "Wrong username or password" });
});
