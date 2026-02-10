import * as cheerio from "cheerio";
import fetch from "node-fetch";

const BASE = "https://satoru.one";
const PROXY = "https://api.codetabs.com/v1/proxy/?quest=";

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
  const res = await fetch(`${PROXY}${BASE}/ajax/episode/list/${movieId}`, {
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

/* ================= ROUTE ================= */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json(
        { success: false, message: "id is required" },
        { status: 400 }
      );
    }

    // Use proxy to fetch the page
    const res = await fetch(`${PROXY}${BASE}/watch/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      return Response.json(
        { success: false, message: "Anime not found" },
        { status: 404 }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    /* ================= BASIC INFO ================= */

    const title = $(".anisc-detail h2").first().text().trim();
    const japaneseTitle = $(".anisc-detail h2 span").text().trim();

    const poster = abs($(".film-poster img").attr("src"));
    const cover = abs($(".anisc-cover img").attr("src"));

    const description = $(".film-description .text").text().trim();

    /* ================= META ================= */

    const meta = {};
    $(".anisc-info .item").each((_, el) => {
      const key = $(el).find(".item-head").text().trim().toLowerCase();
      const value = $(el).find(".name").text().trim();
      meta[key] = value;
    });

    /* ================= SEASONS ================= */

    const seasons = $(".os-item")
      .toArray()
      .map((el) => ({
        id: extractId($(el).attr("href")),
        title: $(el).find(".title").text().trim(),
        poster: abs(
          $(el)
            .find(".season-poster")
            .css("background-image")
            ?.replace(/^url\(["']?/, "")
            ?.replace(/["']?\)$/, "")
        ),
        active: $(el).hasClass("active"),
      }));

    /* ================= EPISODES ================= */

    const movieId = extractMovieIdFromScripts($);
    const episodes = movieId ? await fetchEpisodes(movieId) : [];

    /* ================= AniList ID ================= */

    const anilistId =
      (await fetchAniListIdViaTitle(title)) ||
      (await fetchAniListIdViaTitle(japaneseTitle));

    /* ================= RESPONSE ================= */

    return Response.json({
      success: true,
      data: {
        id,
        movieId,
        anilistId,
        title,
        japaneseTitle,
        poster,
        cover,
        description,
        meta,
        seasons,
        episodes,
        totalEpisodes: episodes.length || meta.episodes || null,
      },
    });
  } catch (err) {
    return Response.json(
      { success: false, message: "Failed to fetch anime info", error: err.message },
      { status: 500 }
    );
  }
}