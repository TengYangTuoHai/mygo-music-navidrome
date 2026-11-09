import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as plugin from "./index.js";

const settings = { server: "https://music.example.com/navidrome/", username: "alice", password: "secret" };
const calls = [];
let reply;
let nativeReply;
let externalReply;
const storage = new Map();
globalThis.host = { setting: key => settings[key], crypto: { md5: text => createHash("md5").update(text).digest("hex") }, storage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) } };
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  calls.push(url);
  if (url.hostname === "api.betterlyrics.org") return externalReply(url, options);
  if (url.pathname.includes("/auth/") || url.pathname.includes("/api/")) {
    return nativeReply(url, options);
  }
  const body = await reply(url.pathname.split("/").pop(), url.searchParams);
  return { ok: true, json: async () => ({ "subsonic-response": body }) };
};
beforeEach(() => {
  calls.length = 0;
  storage.clear();
  settings.server = "https://music.example.com/navidrome/";
  delete settings.lyricsSeparator;
  reply = () => ({ status: "ok" });
  nativeReply = () => ({ ok: false, status: 404 });
  externalReply = () => ({ ok: false, status: 404 });
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

test("sign in verifies credentials and settings changes clear account", async () => {
  assert.deepEqual(await plugin.signIn(), { id: "alice", name: "alice", server: "https://music.example.com/navidrome" });
  assert.equal(calls[0].pathname, "/navidrome/rest/ping");
  assert.equal(plugin.account().name, "alice");
  plugin.setSetting({ key: "password" });
  assert.equal(plugin.account(), null);
});

test("search suggestions combine and deduplicate names", async () => {
  reply = () => ({ status: "ok", searchResult3: { song: [{ title: "Song" }], album: [{ name: "Album" }], artist: [{ name: "Song" }] } });
  assert.deepEqual(await plugin.suggest({ query: "s" }), ["Song", "Album"]);
});

test("genres encode names and paginate", async () => {
  reply = method => method === "getGenres" ? { status: "ok", genres: { genre: [{ value: "R&B:流行" }] } } : method === "getSongsByGenre" ? { status: "ok", songsByGenre: { song: Array.from({ length: 51 }, (_, id) => ({ id, title: "Song" })) } } : { status: "ok", albumList2: { album: [] } };
  const genres = await plugin.browse({ page: "genres" });
  const page = await plugin.browse({ page: genres.sections[0].links[0].page });
  assert.equal(page.title, "R&B:流行");
  assert.equal(page.sections[1].tracks.length, 50);
  assert.equal(page.sections[2].links[0].page, "genre:R%26B%3A%E6%B5%81%E8%A1%8C:50");
});

test("playlist move preserves duplicate tracks and requested order", async () => {
  reply = method => method === "getPlaylist" ? { status: "ok", playlist: { entry: [{ id: "a" }, { id: "b" }, { id: "a" }] } } : { status: "ok" };
  await plugin.movePlaylistTrack({ id: "p", from: 0, to: 1 });
  assert.equal(calls[1].pathname.split("/").pop(), "createPlaylist");
  assert.deepEqual(calls[1].searchParams.getAll("songId"), ["b", "a", "a"]);
});

test("structured lyrics include translations and timed words", async () => {
  reply = () => ({ status: "ok", lyricsList: { structuredLyrics: [
    { kind: "main", offset: 100, cueLine: [{ start: 1000, end: 2000, value: "Hi", cue: [{ start: 1000, end: 2000, value: "Hi" }] }] },
    { kind: "translation", line: [{ value: "你好" }] },
  ] } });
  const result = await plugin.lyrics({ id: "1" });
  assert.equal(result.lines[0].translation, "你好");
  assert.deepEqual(result.lines[0].words[0], { start: 1100, end: 2100, text: "Hi" });
});

test("configured separator splits synced lyrics while preserving timestamps", async () => {
  reply = () => ({ status: "ok", lyricsList: { structuredLyrics: [{ synced: true, line: [
    { start: 1000, value: "Hello - 你好 - 世界" },
    { start: 2500, value: "Untranslated" },
  ] }] } });
  assert.equal((await plugin.lyrics({ id: "1" })).lrc, "[00:01.000]Hello - 你好 - 世界\n[00:02.500]Untranslated");
  settings.lyricsSeparator = "-";
  assert.deepEqual(await plugin.lyrics({ id: "1" }), {
    lrc: "[00:01.000]Hello\n[00:02.500]Untranslated",
    translation: "[00:01.000]你好 - 世界",
  });
});

test("separator splits timed lyrics without singing the translation", async () => {
  settings.lyricsSeparator = " / ";
  reply = () => ({ status: "ok", lyricsList: { structuredLyrics: [{ kind: "main", cueLine: [
    { start: 1000, end: 2000, value: "Hello / 你好", cue: [{ start: 1000, end: 2000, value: "Hello / 你好" }] },
  ] }] } });
  const { lines } = await plugin.lyrics({ id: "1" });
  assert.equal(lines[0].text, "Hello");
  assert.equal(lines[0].translation, "你好");
  assert.equal(lines[0].words.map(word => word.text).join(""), "Hello");
});

test("separator keeps a separately supplied translation", async () => {
  settings.lyricsSeparator = "-";
  reply = () => ({ status: "ok", lyricsList: { structuredLyrics: [
    { kind: "main", synced: true, line: [{ start: 1000, value: "Hello - 你好" }] },
    { kind: "translation", synced: true, line: [{ start: 1000, value: "您好" }] },
  ] } });
  assert.deepEqual(await plugin.lyrics({ id: "1" }), { lrc: "[00:01.000]Hello", translation: "[00:01.000]您好" });
});

test("separator also splits legacy LRC and external timed lyrics", async () => {
  settings.lyricsSeparator = "-";
  reply = method => method === "getSong" ? { status: "ok", song: { id: "1", title: "Song" } }
    : method === "getLyrics" ? { status: "ok", lyrics: { value: "[00:01.00]Hello - 你好" } } : { status: "ok" };
  assert.deepEqual(await plugin.lyrics({ id: "1" }), { lrc: "[00:01.00]Hello", translation: "[00:01.00]你好" });
  reply = method => method === "getSong" ? { status: "ok", song: { id: "1", title: "Song" } } : { status: "ok" };
  externalReply = () => ({ ok: true, json: async () => ({ ttml: '<p begin="00:01.000"><span begin="00:01.000" end="00:02.000">Hello - 你好</span></p>' }) });
  const { lines } = await plugin.lyrics({ id: "1" });
  assert.equal(lines[0].text, "Hello");
  assert.equal(lines[0].translation, "你好");
  assert.equal(lines[0].words.map(word => word.text).join(""), "Hello");
});

test("external lyrics are used when the server has no lyrics and can be disabled", async () => {
  reply = method => method === "getSong" ? { status: "ok", song: { id: "1", title: "Song", artist: "Singer" } } : { status: "ok" };
  externalReply = url => {
    assert.equal(url.searchParams.get("s"), "Song");
    return { ok: true, json: async () => ({ ttml: '<p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">Hello &amp; hi</span></p>' }) };
  };
  const result = await plugin.lyrics({ id: "1" });
  assert.equal(result.lines[0].words[0].text, "Hello & hi");
  settings.betterLyrics = "off";
  const before = calls.length;
  assert.equal((await plugin.lyrics({ id: "1" })).lrc, "");
  assert.ok(calls.slice(before).every(url => url.hostname !== "api.betterlyrics.org"));
  delete settings.betterLyrics;
});

test("radio streams station URLs and never scrobbles stations", async () => {
  reply = () => ({ status: "ok", internetRadioStations: { internetRadioStation: [{ id: "r:1", name: "Radio", streamUrl: "https://radio.example.com/live.aac" }] } });
  const station = (await plugin.stations())[1];
  const [track] = await plugin.stationNext({ id: station.id });
  assert.equal((await plugin.stream({ id: track.id })).type, "aac");
  const count = calls.length;
  await plugin.played({ id: track.id });
  assert.equal(calls.length, count);
});

test("library radio avoids pending songs and relaxes history for small libraries", async () => {
  reply = () => ({ status: "ok", randomSongs: { song: [{ id: "a", title: "A" }, { id: "b", title: "B" }] } });
  storage.set("radioRecent", ["a"]);
  const tracks = await plugin.stationNext({ id: "navidrome:endless" });
  assert.deepEqual(tracks.map(track => track.id), ["b"]);
  storage.set("radioPending", []);
  storage.set("radioRecent", ["a", "b"]);
  assert.equal((await plugin.stationNext({ id: "navidrome:endless" })).length, 2);
});

test("configuration and API errors are surfaced", async () => {
  settings.server = "ftp://example.com";
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup" });
  settings.server = "https://music.example.com";
  reply = () => ({ status: "failed", error: { code: 40, message: "Wrong username or password" } });
  await assert.rejects(plugin.search({ query: "x" }), { code: "setup", message: "Wrong username or password" });
});
