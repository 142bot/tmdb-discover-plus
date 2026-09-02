import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../utils/logger.ts';
import { tmdbFetch } from './client.ts';
import type { TmdbGenre, GenreCache, StaticGenreMap } from '../../types/index.ts';

const log = createLogger('tmdb:genres');

export let genreCache: GenreCache = { movie: {}, tv: {} };

export let staticGenreMap: StaticGenreMap = { movie: {}, tv: {} };
try {
  const genresPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'data',
    'tmdb_genres.json'
  );
  const raw = fs.readFileSync(genresPath, 'utf8');
  staticGenreMap = JSON.parse(raw);
} catch (err) {
  log.warn('Could not load static TMDB genre mapping', { error: (err as Error).message });
}

export async function getGenres(
  apiKey: string,
  type: string = 'movie',
  language: string = 'en'
): Promise<TmdbGenre[]> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';

  if (genreCache[mediaType]?.[lang]) {
    return genreCache[mediaType][lang];
  }
  if (!genreCache[mediaType]) genreCache[mediaType] = {};

  const params: Record<string, string> = {};
  if (lang !== 'en') params.language = lang;

  try {
    const data = (await tmdbFetch(`/genre/${mediaType}/list`, apiKey, params)) as {
      genres: TmdbGenre[];
    };

    if (data?.genres && Array.isArray(data.genres)) {
      if (!genreCache[mediaType]) genreCache[mediaType] = {};
      genreCache[mediaType][lang] = data.genres;
      return data.genres;
    }
  } catch (err) {
    log.warn('Failed to fetch dynamic TMDB genres, using static fallback', {
      type: mediaType,
      error: (err as Error).message,
    });
  }

  // Fallback to static genre map
  const fallback = staticGenreMap[mediaType] || {};
  const staticList: TmdbGenre[] = Object.entries(fallback).map(([id, name]) => ({
    id: Number(id),
    name: name as string,
  }));
  if (staticList.length > 0) {
    if (!genreCache[mediaType]) genreCache[mediaType] = {};
    genreCache[mediaType][lang] = staticList;
  }
  return staticList;
}

export function getCachedGenres(
  type: string = 'movie',
  language: string = 'en'
): TmdbGenre[] | null {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';
  return genreCache[mediaType]?.[lang] || null;
}
