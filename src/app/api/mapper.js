import * as cheerio from "cheerio";
import fetch from "node-fetch";

// Fix for fetch import in Node.js
global.fetch = fetch;

const BASE = "https://satoru.one";

const abs = (url) =>
  url?.startsWith("http") ? url : `${BASE}${url}`;

/* ================= HELPERS ================= */

function extractId(url = "") {
  const clean = url.split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

function extractMovieIdFromScripts($) {
  let movieId = null;

  $("script").each((_, el) => {
    const script = $(el).html();
    if (!script) return;

    const match = script.match(/const\s+movieId\s*=\s*(\d+)/);
    if (match) movieId = match[1];
  });

  return movieId;
}

async function fetchEpisodes(movieId) {
  const res = await fetch(`${BASE}/ajax/episode/list/${movieId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const json = await res.json();
  if (!json?.status || !json?.html) return [];

  const $ = cheerio.load(json.html);

  return $(".ep-item")
    .toArray()
    .map((el) => ({
      id: $(el).attr("data-id"),
      number: Number($(el).attr("data-number")),
      title: $(el).find(".ep-name").text().trim(),
      japaneseTitle:
        $(el).find(".ep-name").attr("data-jname") || null,
      url: abs($(el).attr("href")),
    }));
}

/* ========= AniList ID via fetchNameid API ========= */

async function fetchAniListIdViaTitle(title) {
  if (!title) return null;

  try {
    const res = await fetch(
      `https://anilistapi.vercel.app/api/fetchNameid/${encodeURIComponent(title)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );

    if (!res.ok) return null;

    const json = await res.json();
    return json?.id || json?.data?.id || null;
  } catch {
    return null;
  }
}

/* ================= AniList ID Fetch ================= */

function normalizeTitle(title = "") {
  return title
    .replace(/\b(season|part|cour)\s*\d+/gi, "")
    .replace(/\b(movie|ova|ona|special)\b/gi, "")
    .replace(/[:×]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const anilistCache = new Map();

async function fetchAnilistId(rawTitle) {
  if (!rawTitle) return null;

  const title = normalizeTitle(rawTitle);

  // ✅ cache hit
  if (anilistCache.has(title)) {
    return anilistCache.get(title);
  }

  try {
    const res = await fetch(
      `https://anilistapi.vercel.app/api/fetchNameid/${encodeURIComponent(title)}`
    );

    if (!res.ok) return null;

    const json = await res.json();
    const id = json?.id ?? null;

    // cache only valid IDs
    if (id) {
      anilistCache.set(title, id);
    }

    return id;
  } catch {
    return null;
  }
}

/* ================= SOURCE FETCH ================= */
async function fetchEpisodeSource(serverStreamId) {
  try {
    const res = await fetch(
      `${BASE}/ajax/episode/sources?id=${serverStreamId}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    if (!res.ok) return null;

    const json = await res.json();

    return {
      type: json?.type || null,
      link: json?.link || null,
      server: json?.server || null,
    };
  } catch {
    return null;
  }
}

/* ================= IFRAME → M3U8 ================= */
async function extractM3U8FromIframe(iframeUrl) {
  try {
    const res = await fetch(iframeUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://cdn.buycodeonline.com/",
      },
    });

    if (!res.ok) return null;

    const html = await res.text();

    const direct = html.match(
      /(https?:\/\/[^"' ]+\/master\.m3u8[^"' ]*)/i
    );
    if (direct) return direct[1];

    const any = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/i);
    if (any) return any[0];

    return null;
  } catch {
    return null;
  }
}

/* ================= PARSE MASTER ================= */
async function parseMasterPlaylist(masterUrl) {
  try {
    const res = await fetch(masterUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) return { qualities: [], audioTracks: [] };

    const text = await res.text();
    const lines = text.split("\n");

    const qualities = [];
    const audioTracks = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      /* VIDEO */
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const reso = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
        const bw = line.match(/BANDWIDTH=(\d+)/)?.[1];
        const next = lines[i + 1]?.trim();

        if (next) {
          qualities.push({
            resolution: reso || null,
            bandwidth: bw ? Number(bw) : null,
            url: next.startsWith("http")
              ? next
              : new URL(next, masterUrl).href,
          });
        }
      }

      /* AUDIO */
      if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=AUDIO")) {
        const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1];
        const name = line.match(/NAME="([^"]+)"/)?.[1];
        const uri = line.match(/URI="([^"]+)"/)?.[1];
        const def = line.includes("DEFAULT=YES");

        audioTracks.push({
          language: lang || null,
          name: name || null,
          default: def,
          url: uri
            ? uri.startsWith("http")
              ? uri
              : new URL(uri, masterUrl).href
            : null,
        });
      }
    }

    return { qualities, audioTracks };
  } catch {
    return { qualities: [], audioTracks: [] };
  }
}

/* ================= BUILD STREAMS ================= */
function buildStreams(qualities, audioTracks) {
  const streams = qualities.map((q) => {
    const height = q.resolution?.split("x")[1];

    return {
      label: height ? `${height}p` : "Auto",
      resolution: q.resolution,
      url: q.url,

      audioTracks: audioTracks.map((a) => ({
        language: a.language,
        name: a.name,
        url: a.url,
        default: a.default,
      })),
    };
  });

  /* Sort: low → high */
  streams.sort((a, b) => {
    const x = parseInt(a.label) || 0;
    const y = parseInt(b.label) || 0;
    return x - y;
  });

  return streams;
}

export {
  abs,
  extractId,
  extractMovieIdFromScripts,
  fetchEpisodes,
  fetchAniListIdViaTitle,
  fetchAnilistId,
  fetchEpisodeSource,
  extractM3U8FromIframe,
  parseMasterPlaylist,
  buildStreams
};