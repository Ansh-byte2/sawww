import * as cheerio from "cheerio";
import fetch from "node-fetch";

const BASE = "https://satoru.one";
const PROXY = "https://api.codetabs.com/v1/proxy/?quest=";

const abs = (url) =>
  url?.startsWith("http") ? url : `${BASE}${url}`;

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


/* ================= SLUG ID ================= */

function extractId(url = "") {
  if (!url) return null;
  const clean = url.split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

/* ================= ROUTE ================= */

export async function GET() {
  try {
    // Use proxy to fetch the page
    const res = await fetch(`${PROXY}${BASE}/home`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const html = await res.text();
    const $ = cheerio.load(html);

    /* ================= SPOTLIGHT ================= */

    const spotlight = await Promise.all(
      $(".deslide-item").toArray().map(async (el) => {
        const title = $(el).find(".desi-head-title").text().trim();
        const url = abs($(el).find(".desi-buttons a").first().attr("href"));

        return {
          id: extractId(url),
          title,
          japaneseTitle: $(el).find(".desi-head-title").attr("data-jname"),
          image: abs($(el).find(".film-poster-img").attr("src")),
          type: $(el).find(".scd-item").eq(0).text().trim(),
          duration: $(el).find(".scd-item").eq(1).text().trim(),
          releaseDate: $(el).find(".scd-item.m-hide").text().trim(),
          description: $(el).find(".desi-description").text().trim(),
          url,
          anilistId: await fetchAnilistId(title)
        };
      })
    );

    /* ================= TRENDING ================= */

    const trending = await Promise.all(
      $("#trending-home .swiper-slide").toArray().map(async (el, i) => {
        const title = $(el).find(".film-title").text().trim();
        const url = abs($(el).find("a").attr("href"));

        return {
          id: extractId(url),
          rank: i + 1,
          title,
          japaneseTitle: $(el).find(".film-title").attr("data-jname"),
          image: abs($(el).find("img").attr("src")),
          url,
          anilistId: await fetchAnilistId(title)
        };
      })
    );

    /* ================= TOP AIRING ================= */

    const topAiring = await Promise.all(
      $(".anif-block-01 li").toArray().map(async (el) => {
        const title = $(el).find(".film-name a").text().trim();
        const url = abs($(el).find("a").attr("href"));

        return {
          id: extractId(url),
          title,
          japaneseTitle: $(el).find(".film-name a").attr("data-jname"),
          image: abs($(el).find("img").attr("data-src") || $(el).find("img").attr("src")),
          url,
          type: $(el).find(".tick").text().trim(),
          anilistId: await fetchAnilistId(title)
        };
      })
    );

    /* ================= COMPLETED ================= */

    const completed = await Promise.all(
      $(".anif-block-02 li").toArray().map(async (el) => {
        const title = $(el).find(".film-name a").text().trim();
        const url = abs($(el).find("a").attr("href"));

        return {
          id: extractId(url),
          title,
          japaneseTitle: $(el).find(".film-name a").attr("data-jname"),
          image: abs($(el).find("img").attr("data-src") || $(el).find("img").attr("src")),
          url,
          type: $(el).find(".tick").text().trim(),
          anilistId: await fetchAnilistId(title)
        };
      })
    );

    /* ================= LATEST EPISODES ================= */

    const latestEpisodes = await Promise.all(
      $(".block_area_home .flw-item").toArray().map(async (el) => {
        const title = $(el).find(".film-name a").text().trim();
        const url = abs($(el).find(".film-poster-ahref").attr("href"));

        return {
          id: extractId(url),
          title,
          japaneseTitle: $(el).find(".film-name a").attr("data-jname"),
          image: abs($(el).find("img").attr("data-src") || $(el).find("img").attr("src")),
          url,
          type: $(el).find(".fdi-item").first().text().trim(),
          duration: $(el).find(".fdi-duration").text().trim(),
          episodeProgress: $(el).find(".tick-eps").text().trim(),
          languages: $(el).find(".tick-dub span").toArray().map(l => $(l).text().trim()),
          isAdult: $(el).find(".tick-rate").length > 0,
          anilistId: await fetchAnilistId(title)
        };
      })
    );

    /* ================= GENRES ================= */

    const genres = $("#sidebar_subs_genre a").toArray().map(el => ({
      name: $(el).text().trim(),
      url: abs($(el).attr("href"))
    }));

    return Response.json({
      success: true,
      data: {
        spotlight,
        trending,
        topAiring,
        completed,
        latestEpisodes,
        genres
      }
    });
  } catch (error) {
    return Response.json(
      { success: false, message: "Failed to fetch home data", error: error.message },
      { status: 500 }
    );
  }
}