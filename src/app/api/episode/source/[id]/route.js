import * as cheerio from "cheerio";
import fetch from "node-fetch";

const BASE = "https://satoru.one";
const PROXY = "https://api.codetabs.com/v1/proxy/?quest=";

/* ================= USER AGENT ================= */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

/* ================= HEADERS ================= */

function getBrowserHeaders(referer = BASE) {
  return {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": referer,
    "Origin": BASE,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Connection": "keep-alive",
    // Optional (sometimes helps)
    "Cookie": "__ddg2_=;",
  };
}

/* ================= SOURCE FETCH ================= */

async function fetchEpisodeSource(serverStreamId, episodeId) {
  try {
    const res = await fetch(
      `${PROXY}${BASE}/ajax/episode/sources?id=${serverStreamId}`,
      {
        headers: getBrowserHeaders(`${BASE}/watch/${episodeId}`),
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
    // Only use proxy if the iframe URL is from satoru.one domain
    const fetchUrl = iframeUrl.includes(BASE) 
      ? `${PROXY}${iframeUrl}` 
      : iframeUrl;

    const res = await fetch(fetchUrl, {
      headers: {
        ...getBrowserHeaders(BASE),
        Referer: BASE,
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

/* ================= AUDIO TRACKS ================= */

async function extractAudioTracks(masterUrl) {
  try {
    // Don't use proxy for m3u8 files (they're usually on CDN servers)
    const res = await fetch(masterUrl, {
      headers: getBrowserHeaders(BASE),
    });

    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split("\n");

    const tracks = [];

    for (const line of lines) {
      if (
        line.startsWith("#EXT-X-MEDIA") &&
        line.includes("TYPE=AUDIO")
      ) {
        const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1] || null;
        const name = line.match(/NAME="([^"]+)"/)?.[1] || null;
        const uri = line.match(/URI="([^"]+)"/)?.[1] || null;
        const groupId =
          line.match(/GROUP-ID="([^"]+)"/)?.[1] || null;

        const isDefault = line.includes("DEFAULT=YES");

        tracks.push({
          language: lang,
          name,
          groupId,
          default: isDefault,
          url: uri
            ? uri.startsWith("http")
              ? uri
              : new URL(uri, masterUrl).href
            : null,
        });
      }
    }

    return tracks;
  } catch {
    return [];
  }
}

/* ================= QUALITIES WITH AUDIO ================= */

async function extractQualitiesWithAudio(masterUrl) {
  try {
    // Don't use proxy for m3u8 files (they're usually on CDN servers)
    const res = await fetch(masterUrl, {
      headers: getBrowserHeaders(BASE),
    });

    if (!res.ok) return { qualities: [], audioTracks: [] };

    const text = await res.text();
    const lines = text.split("\n");

    // First, extract all audio tracks
    const audioTracks = [];
    
    for (const line of lines) {
      if (
        line.startsWith("#EXT-X-MEDIA") &&
        line.includes("TYPE=AUDIO")
      ) {
        const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1] || null;
        const name = line.match(/NAME="([^"]+)"/)?.[1] || null;
        const uri = line.match(/URI="([^"]+)"/)?.[1] || null;
        const groupId =
          line.match(/GROUP-ID="([^"]+)"/)?.[1] || null;

        const isDefault = line.includes("DEFAULT=YES");

        audioTracks.push({
          language: lang,
          name,
          groupId,
          default: isDefault,
          url: uri
            ? uri.startsWith("http")
              ? uri
              : new URL(uri, masterUrl).href
            : null,
        });
      }
    }

    // Now extract qualities with their associated audio
    const qualities = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const info = lines[i];
        const next = lines[i + 1]?.trim();

        const resolution =
          info.match(/RESOLUTION=(\d+x\d+)/)?.[1] || null;

        const bandwidth =
          info.match(/BANDWIDTH=(\d+)/)?.[1] || null;

        // Extract the AUDIO group reference
        const audioGroupId = info.match(/AUDIO="([^"]+)"/)?.[1] || null;

        // Filter audio tracks that belong to this quality
        const qualityAudioTracks = audioGroupId
          ? audioTracks.filter(track => track.groupId === audioGroupId)
          : audioTracks; // If no specific group, include all

        if (next) {
          qualities.push({
            resolution,
            bandwidth: bandwidth ? Number(bandwidth) : null,
            url: next.startsWith("http")
              ? next
              : new URL(next, masterUrl).href,
            audioTracks: qualityAudioTracks,
          });
        }
      }
    }

    return { qualities, audioTracks };
  } catch {
    return { qualities: [], audioTracks: [] };
  }
}

/* ================= API ================= */

export async function GET(req, { params }) {
  try {
    const resolvedParams = await params;
    const episodeId = resolvedParams.id;

    if (!episodeId) {
      return Response.json(
        { success: false, message: "episodeId is required" },
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
          }
        }
      );
    }

    /* ---------- Fetch Servers ---------- */

    const res = await fetch(
      `${PROXY}${BASE}/ajax/episode/servers?episodeId=${episodeId}`,
      {
        headers: getBrowserHeaders(`${BASE}/watch/${episodeId}`),
      }
    );

    if (!res.ok) {
      return Response.json(
        { success: false, message: "Failed to fetch servers" },
        { 
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
          }
        }
      );
    }

    const json = await res.json();

    if (!json?.status) {
      return Response.json(
        { success: false, message: "Invalid response" },
        { 
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
          }
        }
      );
    }

    /* ---------- Skip Times ---------- */

    const skip = Array.isArray(json.skip)
      ? json.skip.map((s) => ({
          type: s.skip_type,
          start: Number(s.start_time),
          end: Number(s.end_time),
        }))
      : [];

    /* ---------- Parse Servers ---------- */

    const $ = cheerio.load(json.html);

    const servers = [];

    $(".server-item").each((_, el) => {
      servers.push({
        id: $(el).attr("data-id"),
        serverId: $(el).attr("data-server-id"),
        type: $(el).attr("data-type") || "sub",
        name: $(el).find("a").text().trim(),
      });
    });

    const preferredServer =
      servers.find((s) => s.serverId === "6") || servers[0];

    /* ---------- Extract Streams ---------- */

    let source = null;
    let m3u8 = null;
    let qualities = [];
    let audioTracks = [];

    if (preferredServer?.id) {
      source = await fetchEpisodeSource(
        preferredServer.id,
        episodeId
      );

      if (source?.type === "iframe" && source?.link) {
        m3u8 = await extractM3U8FromIframe(source.link);

        if (m3u8) {
          const result = await extractQualitiesWithAudio(m3u8);
          qualities = result.qualities;
          audioTracks = result.audioTracks;
        }
      }
    }

    /* ---------- Response ---------- */

    return Response.json({
      success: true,
      data: {
        episodeId,
        skip,
        servers,
        source,
        m3u8,
        qualities,
      },
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true'
      }
    });
  } catch (err) {
    console.error(err);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch episode servers",
        error: err.message,
      },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true'
        }
      }
    );
  }
}
