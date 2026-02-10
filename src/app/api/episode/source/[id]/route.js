import * as cheerio from "cheerio";
import fetch from "node-fetch";

const BASE = "https://satoru.one";

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

/* ================= API ================= */
export async function GET(req, { params }) {
  try {
    const { id: episodeId } = await params;

    if (!episodeId) {
      return Response.json(
        { success: false, message: "episodeId is required" },
        { status: 400 }
      );
    }

    /* FETCH SERVERS */
    const res = await fetch(
      `${BASE}/ajax/episode/servers?episodeId=${episodeId}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    if (!res.ok) {
      return Response.json(
        { success: false, message: "Failed to fetch servers" },
        { status: 500 }
      );
    }

    const json = await res.json();

    if (!json?.status) {
      return Response.json(
        { success: false, message: "Invalid response" },
        { status: 500 }
      );
    }

    /* SKIPS */
    const skip = Array.isArray(json.skip)
      ? json.skip.map((s) => ({
          type: s.skip_type,
          start: Number(s.start_time),
          end: Number(s.end_time),
        }))
      : [];

    /* SERVERS */
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

    /* PREFER SERVER 6 */
    const preferred =
      servers.find((s) => s.serverId === "6") || servers[0];

    let source = null;
    let m3u8 = null;
    let streams = [];

    if (preferred?.id) {
      source = await fetchEpisodeSource(preferred.id);

      if (source?.type === "iframe" && source?.link) {
        m3u8 = await extractM3U8FromIframe(source.link);

        if (m3u8) {
          const { qualities, audioTracks } =
            await parseMasterPlaylist(m3u8);

          streams = buildStreams(qualities, audioTracks);
        }
      }
    }

    /* RESPONSE */
    return Response.json({
      success: true,
      data: {
        episodeId,
        skip,
        servers,
        source,
        m3u8,
        streams,
      },
    });
  } catch (err) {
    console.error(err);

    return Response.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
