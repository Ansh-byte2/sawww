import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

import {
  abs,
  extractId,
  extractMovieIdFromScripts,
  fetchEpisodes,
  fetchAniListIdViaTitle,
  fetchAnilistId,
  fetchEpisodeSource,
  extractM3U8FromIframe,
  parseMasterPlaylist,
  buildStreams,
} from "./mapper.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const BASE = "https://satoru.one";

/* ================= EPISODE SOURCE ================= */
export async function getEpisodeSource(episodeId) {
  if (!episodeId) {
    return {
      success: false,
      message: "episodeId is required",
    };
  }

  try {
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
      return {
        success: false,
        message: "Failed to fetch servers",
      };
    }

    const json = await res.json();

    if (!json?.status) {
      return {
        success: false,
        message: "Invalid response",
      };
    }

    /* SKIP TIMES */
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

    return {
      success: true,
      data: {
        episodeId,
        skip,
        servers,
        source,
        m3u8,
        streams,
      },
    };
  } catch (err) {
    console.error(err);

    return {
      success: false,
      message: "Internal Server Error",
    };
  }
}

/* ================= HOME ================= */
export async function getHomeData() {
  try {
    const res = await fetch(`${BASE}/home`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const html = await res.text();

    const $ = cheerio.load(html);

    /* SPOTLIGHT */
    const spotlight = await Promise.all(
      $(".deslide-item").toArray().map(async (el) => {
        const title = $(el).find(".desi-head-title").text().trim();

        const url = abs(
          $(el).find(".desi-buttons a").first().attr("href")
        );

        return {
          id: extractId(url),
          title,
          japaneseTitle: $(el)
            .find(".desi-head-title")
            .attr("data-jname"),

          image: abs(
            $(el).find(".film-poster-img").attr("src")
          ),

          type: $(el).find(".scd-item").eq(0).text().trim(),

          duration: $(el).find(".scd-item").eq(1).text().trim(),

          releaseDate: $(el)
            .find(".scd-item.m-hide")
            .text()
            .trim(),

          description: $(el)
            .find(".desi-description")
            .text()
            .trim(),

          url,

          anilistId: await fetchAnilistId(title),
        };
      })
    );

    /* TRENDING */
    const trending = await Promise.all(
      $("#trending-home .swiper-slide").toArray().map(async (el, i) => {
        const title = $(el).find(".film-title").text().trim();

        const url = abs($(el).find("a").attr("href"));

        return {
          id: extractId(url),
          rank: i + 1,
          title,

          japaneseTitle: $(el)
            .find(".film-title")
            .attr("data-jname"),

          image: abs($(el).find("img").attr("src")),

          url,

          anilistId: await fetchAnilistId(title),
        };
      })
    );

    return {
      success: true,
      data: {
        spotlight,
        trending,
      },
    };
  } catch (err) {
    console.error(err);

    return {
      success: false,
      message: "Failed to fetch home data",
    };
  }
}

/* ================= ANIME INFO ================= */
export async function getAnimeInfo(id) {
  if (!id) {
    return {
      success: false,
      message: "id is required",
    };
  }

  try {
    const res = await fetch(`${BASE}/watch/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      return {
        success: false,
        message: "Anime not found",
      };
    }

    const html = await res.text();

    const $ = cheerio.load(html);

    /* BASIC INFO */
    const title = $(".anisc-detail h2").first().text().trim();

    const japaneseTitle = $(".anisc-detail h2 span")
      .text()
      .trim();

    const poster = abs($(".film-poster img").attr("src"));

    const cover = abs($(".anisc-cover img").attr("src"));

    const description = $(".film-description .text")
      .text()
      .trim();

    /* EPISODES */
    const movieId = extractMovieIdFromScripts($);

    const episodes = movieId
      ? await fetchEpisodes(movieId)
      : [];

    /* ANILIST */
    const anilistId =
      (await fetchAniListIdViaTitle(title)) ||
      (await fetchAniListIdViaTitle(japaneseTitle));

    return {
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
        episodes,
        totalEpisodes: episodes.length || null,
      },
    };
  } catch (err) {
    console.error(err);

    return {
      success: false,
      message: "Failed to fetch anime info",
    };
  }
}

/* ================= EXPRESS ROUTES ================= */

// Home
app.get("/api/home", async (req, res) => {
  res.json(await getHomeData());
});

// Anime Info
app.get("/api/info", async (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id query parameter is required"
    });
  }
  res.json(await getAnimeInfo(id));
});

// Episode Source
app.get("/api/watch/:episodeId", async (req, res) => {
  res.json(await getEpisodeSource(req.params.episodeId));
});

/* ================= SERVER ================= */

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

/* ================= EXPORT ================= */

export default app;
