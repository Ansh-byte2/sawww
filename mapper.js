// mapper.js

// Function to map episode data from info route
function mapEpisodeData(episode) {
  return {
    id: episode.id,
    number: episode.number,
    title: episode.title,
    japaneseTitle: episode.japaneseTitle,
    url: episode.url
  };
}

// Function to map series data from info route
function mapSeriesData(series) {
  return {
    id: series.id,
    title: series.title,
    japaneseTitle: series.japaneseTitle,
    poster: series.poster,
    cover: series.cover,
    description: series.description,
    seasons: series.seasons,
    episodes: series.episodes.map(mapEpisodeData),
    totalEpisodes: series.totalEpisodes,
    anilistId: series.anilistId
  };
}

// Function to map source data from episode source route
function mapSourceData(source) {
  return {
    type: source.type,
    link: source.link,
    server: source.server
  };
}

// Function to map home data from home route
function mapHomeData(home) {
  return {
    spotlight: home.spotlight.map(item => ({
      id: item.id,
      title: item.title,
      japaneseTitle: item.japaneseTitle,
      image: item.image,
      type: item.type,
      duration: item.duration,
      releaseDate: item.releaseDate,
      description: item.description,
      url: item.url,
      anilistId: item.anilistId
    })),
    trending: home.trending.map(item => ({
      id: item.id,
      rank: item.rank,
      title: item.title,
      japaneseTitle: item.japaneseTitle,
      image: item.image,
      url: item.url,
      anilistId: item.anilistId
    })),
    topAiring: home.topAiring.map(item => ({
      id: item.id,
      title: item.title,
      japaneseTitle: item.japaneseTitle,
      image: item.image,
      url: item.url,
      type: item.type,
      anilistId: item.anilistId
    })),
    completed: home.completed.map(item => ({
      id: item.id,
      title: item.title,
      japaneseTitle: item.japaneseTitle,
      image: item.image,
      url: item.url,
      type: item.type,
      anilistId: item.anilistId
    })),
    latestEpisodes: home.latestEpisodes.map(item => ({
      id: item.id,
      title: item.title,
      japaneseTitle: item.japaneseTitle,
      image: item.image,
      url: item.url,
      type: item.type,
      duration: item.duration,
      episodeProgress: item.episodeProgress,
      languages: item.languages,
      isAdult: item.isAdult,
      anilistId: item.anilistId
    })),
    genres: home.genres
  };
}

// Function to map info data from info route
function mapInfoData(info) {
  return {
    id: info.id,
    movieId: info.movieId,
    anilistId: info.anilistId,
    title: info.title,
    japaneseTitle: info.japaneseTitle,
    poster: info.poster,
    cover: info.cover,
    description: info.description,
    seasons: info.seasons,
    episodes: info.episodes.map(mapEpisodeData),
    totalEpisodes: info.totalEpisodes
  };
}

// Function to map episode source data from episode source route
function mapEpisodeSourceData(data) {
  return {
    episodeId: data.episodeId,
    skip: data.skip.map(s => ({
      type: s.type,
      start: s.start,
      end: s.end
    })),
    servers: data.servers.map(server => ({
      id: server.id,
      serverId: server.serverId,
      type: server.type,
      name: server.name
    })),
    source: data.source ? mapSourceData(data.source) : null,
    m3u8: data.m3u8,
    streams: data.streams.map(stream => ({
      label: stream.label,
      resolution: stream.resolution,
      url: stream.url,
      audioTracks: stream.audioTracks.map(audio => ({
        language: audio.language,
        name: audio.name,
        url: audio.url,
        default: audio.default
      }))
    }))
  };
}

module.exports = {
  mapEpisodeData,
  mapSeriesData,
  mapSourceData,
  mapHomeData,
  mapInfoData,
  mapEpisodeSourceData
};
