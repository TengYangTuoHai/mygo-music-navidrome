// Navidrome exposes the Subsonic API. All IDs below are server IDs.
const PAGE_SIZE = 50;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function config() {
  const server = (host.setting("server") || "").trim().replace(/\/+$/, "");
  const username = (host.setting("username") || "").trim();
  const password = host.setting("password") || "";
  if (!server || !username || !password) throw fail("setup", "请在插件设置中填写服务器地址、用户名和密码");
  let url;
  try { url = new URL(server); } catch { throw fail("setup", "服务器地址无效，请填写完整的 HTTP 或 HTTPS 地址"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw fail("setup", "服务器地址须为不含凭据、查询参数或片段的 HTTP 或 HTTPS 地址");
  }
  return { server, username, password };
}

function endpoint(method, params = {}) {
  const { server, username, password } = config();
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const url = new URL(`${server}/rest/${method}`);
  const entries = { u: username, t: host.crypto.md5(password + salt), s: salt, v: "1.16.1", c: "mygo-music-navidrome", f: "json", ...params };
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  return url.toString();
}

async function request(method, params) {
  const response = await fetch(endpoint(method, params));
  if (!response.ok) throw new Error(`Navidrome 请求失败（HTTP ${response.status}）`);
  const data = (await response.json())["subsonic-response"];
  if (!data || data.status !== "ok") {
    const error = data?.error;
    throw fail(error?.code === 40 || error?.code === 41 ? "setup" : "unavailable", error?.message || "Navidrome 返回了无效响应");
  }
  return data;
}

const list = value => Array.isArray(value) ? value : value ? [value] : [];
const cover = id => id ? endpoint("getCoverArt", { id, size: 800 }) : "";
function toArtist(a) {
  return { id: String(a.id || ""), name: a.name || "", imageUrl: cover(a.coverArt), following: !!a.starred };
}
function toAlbum(a) {
  return { id: String(a.id || ""), name: a.name || a.title || "", imageUrl: cover(a.coverArt), artists: a.artist ? [{ id: String(a.artistId || ""), name: a.artist }] : [], released: a.year ? String(a.year) : "", saved: !!a.starred };
}
function toTrack(s) {
  return { id: String(s.id), name: s.title || "", artists: s.artist ? [{ id: String(s.artistId || ""), name: s.artist }] : [], album: toAlbum({ id: s.albumId, name: s.album, coverArt: s.coverArt, artist: s.artist, artistId: s.artistId, year: s.year }), duration: (Number(s.duration) || 0) * 1000 };
}
function toPlaylist(p) {
  const username = config().username;
  return { id: String(p.id), name: p.name || "", imageUrl: cover(p.coverArt), description: p.comment || "", owner: p.owner || "", trackCount: p.songCount || 0, mine: p.owner === username, saved: !!p.owner && p.owner !== username };
}

export async function home() {
  const [random, newest, recent] = await Promise.all([
    request("getRandomSongs", { size: 24 }),
    request("getAlbumList2", { type: "newest", size: 24 }),
    request("getAlbumList2", { type: "recent", size: 24 }),
  ]);
  return { title: "发现音乐", sections: [
    { title: "随机歌曲", tracks: list(random.randomSongs?.song).map(toTrack) },
    { title: "最近添加", albums: list(newest.albumList2?.album).map(toAlbum) },
    { title: "最近播放", albums: list(recent.albumList2?.album).map(toAlbum) },
  ] };
}

let nativeSession = null;

// The native API is the Web UI's internal API and can differ between releases.
// A missing route falls back to the public Subsonic API; authentication and
// other server errors are reported instead of being silently hidden.
async function nativeArtists() {
  const { server, username, password } = config();
  const sessionKey = `${server}\n${username}\n${password}`;
  async function login() {
    const response = await fetch(`${server}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (response.status === 404 || response.status === 405) return null;
    if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? "setup" : "unavailable", `Navidrome 登录失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!data?.token) throw fail("unavailable", "Navidrome 登录响应缺少令牌");
    nativeSession = { key: sessionKey, token: data.token };
    return nativeSession;
  }
  let session = nativeSession?.key === sessionKey ? nativeSession : await login();
  if (!session) return null;
  let refreshed = false;
  const artists = [];
  for (let offset = 0; ; offset += 500) {
    const url = new URL(`${server}/api/artist`);
    url.searchParams.set("_start", String(offset));
    url.searchParams.set("_end", String(offset + 500));
    url.searchParams.set("_sort", "name");
    url.searchParams.set("_order", "ASC");
    let response = await fetch(url.toString(), { headers: { "X-ND-Authorization": `Bearer ${session.token}` } });
    if (response.status === 401 && !refreshed) {
      session = await login();
      if (!session) return null;
      refreshed = true;
      response = await fetch(url.toString(), { headers: { "X-ND-Authorization": `Bearer ${session.token}` } });
    }
    if (response.status === 404 || response.status === 405) return null;
    if (!response.ok) throw new Error(`Navidrome 艺人列表请求失败（HTTP ${response.status}）`);
    const page = await response.json();
    if (!Array.isArray(page)) throw fail("unavailable", "Navidrome 艺人列表响应无效");
    artists.push(...page.map(a => toArtist({ ...a, coverArt: a.imageAbsent ? "" : `ar-${a.id}` })));
    if (page.length < 500) return artists;
  }
}

export async function browse({ page }) {
  if (page === "liked-artists") {
    const artists = list((await starred()).artist).map(toArtist);
    return { title: "我喜欢的艺人", sections: [{ artists, empty: "还没有喜欢的艺人" }] };
  }
  if (page === "artists") {
    const native = await nativeArtists();
    if (native) return { title: "艺人", sections: [{ artists: native, empty: "音乐库中没有艺人" }] };
    const data = await request("getArtists");
    const artists = list(data.artists?.index).flatMap(group => list(group.artist)).map(toArtist);
    return { title: "艺人", sections: [{ artists, empty: "音乐库中没有艺人" }] };
  }
  if (page === "albums" || /^albums:\d+$/.test(page)) {
    const offset = page === "albums" ? 0 : Number(page.slice(7));
    if (!Number.isSafeInteger(offset) || offset < 0) throw fail("unavailable", "无效的专辑页码");
    const albums = list((await request("getAlbumList2", { type: "alphabeticalByName", size: PAGE_SIZE + 1, offset })).albumList2?.album);
    const links = [];
    if (offset > 0) links.push({ title: "上一页", page: offset <= PAGE_SIZE ? "albums" : `albums:${offset - PAGE_SIZE}` });
    if (albums.length > PAGE_SIZE) links.push({ title: "下一页", page: `albums:${offset + PAGE_SIZE}` });
    return { title: "专辑", subtitle: `第 ${Math.floor(offset / PAGE_SIZE) + 1} 页`, sections: [
      { albums: albums.slice(0, PAGE_SIZE).map(toAlbum), empty: "没有更多专辑" },
      ...(links.length ? [{ links }] : []),
    ] };
  }
  throw fail("unavailable", "页面不存在");
}

export async function search({ query, kind = "tracks", offset = 0 }) {
  if (kind === "playlists") {
    const matches = (await playlists()).filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
    return { playlists: matches.slice(offset, offset + PAGE_SIZE), more: offset + PAGE_SIZE < matches.length };
  }
  const types = { tracks: ["song", toTrack], albums: ["album", toAlbum], artists: ["artist", toArtist] };
  if (!types[kind]) return { [kind]: [], more: false };
  const [type, convert] = types[kind];
  const params = { query, songCount: 0, albumCount: 0, artistCount: 0 };
  params[`${type}Count`] = PAGE_SIZE + 1;
  params[`${type}Offset`] = offset;
  const result = list((await request("search3", params)).searchResult3?.[type]);
  return { [kind]: result.slice(0, PAGE_SIZE).map(convert), more: result.length > PAGE_SIZE };
}

export async function album({ id }) {
  const a = (await request("getAlbum", { id })).album;
  if (!a) throw fail("unavailable", "专辑不存在");
  return { album: toAlbum(a), tracks: list(a.song).map(toTrack) };
}
export async function artist({ id }) {
  const a = (await request("getArtist", { id })).artist;
  if (!a) throw fail("unavailable", "歌手不存在");
  return { artist: toArtist(a), albums: list(a.album).map(toAlbum), tracks: [] };
}
export async function playlists() {
  return list((await request("getPlaylists")).playlists?.playlist).map(toPlaylist);
}
export async function playlist({ id }) {
  const p = (await request("getPlaylist", { id })).playlist;
  if (!p) throw fail("unavailable", "歌单不存在或无权访问");
  return { ...toPlaylist(p), tracks: list(p.entry).map(toTrack) };
}
export async function createPlaylist({ name }) {
  const p = (await request("createPlaylist", { name })).playlist;
  if (!p) throw fail("unavailable", "服务器未返回新建歌单");
  return toPlaylist(p);
}
export async function renamePlaylist({ id, name }) { await request("updatePlaylist", { playlistId: id, name }); }
export async function deletePlaylist({ id }) { await request("deletePlaylist", { id }); }
export async function addToPlaylist({ id, trackIds }) {
  if (trackIds.length) await request("updatePlaylist", { playlistId: id, songIdToAdd: trackIds });
}
export async function removeFromPlaylist({ id, trackIds }) {
  const p = (await request("getPlaylist", { id })).playlist;
  if (!p) throw fail("unavailable", "歌单不存在或无权访问");
  const ids = new Set(trackIds.map(String));
  const indices = list(p.entry).map((song, i) => ids.has(String(song.id)) ? i : -1).filter(i => i >= 0).reverse();
  if (indices.length) await request("updatePlaylist", { playlistId: id, songIndexToRemove: indices });
}

async function starred() { return (await request("getStarred2")).starred2 || {}; }
export async function liked({ offset = 0 } = {}) {
  const songs = list((await starred()).song);
  return { tracks: songs.slice(offset, offset + PAGE_SIZE).map(toTrack), more: offset + PAGE_SIZE < songs.length };
}
export async function isLiked({ ids }) {
  const set = new Set(list((await starred()).song).map(s => String(s.id)));
  return Object.fromEntries(ids.map(id => [id, set.has(String(id))]));
}
export async function like({ id, on }) { await request(on ? "star" : "unstar", { id }); }
export async function saveAlbum({ id, on }) { await request(on ? "star" : "unstar", { albumId: id }); }
export async function followArtist({ id, on }) { await request(on ? "star" : "unstar", { artistId: id }); }
export async function savedAlbums({ offset = 0 } = {}) {
  const albums = list((await starred()).album);
  return { albums: albums.slice(offset, offset + PAGE_SIZE).map(toAlbum), more: offset + PAGE_SIZE < albums.length };
}
export async function played({ id }) { await request("scrobble", { id, submission: true }); }

export async function lyrics({ id }) {
  const data = await request("getLyricsBySongId", { id });
  const lyrics = list(data.lyricsList?.structuredLyrics);
  const selected = lyrics.find(item => item.synced && list(item.line).length) || lyrics.find(item => list(item.line).length);
  if (!selected) return { lrc: "" };
  const lrc = list(selected.line).map(line => {
    if (!selected.synced || line.start == null) return line.value || "";
    const time = Math.floor(Math.max(0, Number(line.start) + (Number(selected.offset) || 0)));
    const minutes = Math.floor(time / 60000);
    const seconds = (Math.floor(time % 60000 / 1000)).toString().padStart(2, "0");
    const milliseconds = (time % 1000).toString().padStart(3, "0");
    return `[${String(minutes).padStart(2, "0")}:${seconds}.${milliseconds}]${line.value || ""}`;
  }).join("\n");
  return { lrc };
}

export async function stream({ id, quality = "high" }) {
  const song = (await request("getSong", { id })).song;
  if (!song) throw fail("unavailable", "歌曲不存在或无权访问");
  const suffix = (song.suffix || "").toLowerCase();
  const types = { mp3: "mp3", flac: "flac", ogg: "ogg", oga: "ogg", wav: "wav", m4a: "m4a", mp4: "m4a", aac: "aac" };
  const lossless = quality === "lossless";
  if (lossless && types[suffix]) {
    return { url: endpoint("stream", { id, format: "raw" }), type: types[suffix] };
  }
  // Request a known output format so the player's decoder matches the stream.
  // Navidrome may serve an already-compatible MP3 directly if it is below the limit.
  const maxBitRate = quality === "standard" ? 128 : 320;
  return { url: endpoint("stream", { id, format: "mp3", maxBitRate }), type: "mp3" };
}
