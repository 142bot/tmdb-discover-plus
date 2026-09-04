export interface JikanAnime {
  mal_id: number;
  url: string;
  images: {
    jpg: { image_url?: string; small_image_url?: string; large_image_url?: string };
    webp?: { image_url?: string; small_image_url?: string; large_image_url?: string };
  };
  trailer?: { youtube_id?: string; url?: string };
  title: string;
  title_english?: string | null;
  title_japanese?: string | null;
  titles?: Array<{ type: string; title: string }>;
  type?: string | null;
  source?: string | null;
  episodes?: number | null;
  status?: string | null;
  airing?: boolean;
  aired?: { from?: string | null; to?: string | null; string?: string };
  duration?: string | null;
  rating?: string | null;
  score?: number | null;
  scored_by?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number;
  favorites?: number;
  synopsis?: string | null;
  season?: string | null;
  year?: number | null;
  studios?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  genres?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  themes?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  demographics?: Array<{ mal_id: number; type: string; name: string; url: string }>;
}

// Keep MalAnime as alias for backward compatibility with stremioMeta.ts
export interface MalAnime {
  id: number;
  title: string;
  main_picture?: { medium?: string; large?: string };
  alternative_titles?: { en?: string; ja?: string };
  start_date?: string;
  synopsis?: string;
  mean?: number;
  rank?: number;
  popularity?: number;
  genres?: Array<{ id: number; name: string }>;
  media_type?: string;
  status?: string;
  num_episodes?: number;
  start_season?: { year: number; season: string };
  source?: string;
  studios?: Array<{ id: number; name: string }>;
}

export interface JikanPagination {
  last_visible_page: number;
  has_next_page: boolean;
  current_page: number;
  items: { count: number; total: number; per_page: number };
}

export interface JikanResponse {
  pagination: JikanPagination;
  data: JikanAnime[];
}

/**
 * Convert a Jikan anime object to the MalAnime shape used by stremioMeta.ts.
 * This avoids rewriting the conversion layer.
 */
export function jikanToMalAnime(j: JikanAnime): MalAnime {
  return {
    id: j.mal_id,
    title: j.title,
    main_picture: {
      large: j.images?.jpg?.large_image_url || j.images?.webp?.large_image_url,
      medium: j.images?.jpg?.image_url || j.images?.webp?.image_url,
    },
    alternative_titles: {
      en: j.title_english || undefined,
      ja: j.title_japanese || undefined,
    },
    start_date: j.aired?.from?.split('T')[0] || undefined,
    synopsis: j.synopsis || undefined,
    mean: j.score || undefined,
    rank: j.rank || undefined,
    popularity: j.popularity || undefined,
    genres: [...(j.genres || []), ...(j.themes || []), ...(j.demographics || [])].map((g) => ({
      id: g.mal_id,
      name: g.name,
    })),
    media_type: j.type?.toLowerCase() || undefined,
    status: j.status || undefined,
    num_episodes: j.episodes || undefined,
    start_season: j.season && j.year ? { year: j.year, season: j.season } : undefined,
    source: j.source || undefined,
    studios: j.studios?.map((s) => ({ id: s.mal_id, name: s.name })),
  };
}

export const MAL_RANKING_TYPES = [
  { value: 'all', label: '✨ Top Anime', description: "MAL's overall top-ranked anime" },
  { value: 'airing', label: '📡 Currently Airing', description: 'Top-ranked anime airing now' },
  { value: 'upcoming', label: '📅 Upcoming', description: 'Top-ranked anime not yet released' },
  { value: 'tv', label: '📺 Top TV Series', description: 'Top-ranked TV series' },
  { value: 'movie', label: '🎬 Top Movies', description: 'Top-ranked anime movies' },
  { value: 'ova', label: '💿 Top OVA', description: 'Top-ranked original video animations' },
  { value: 'special', label: '🌟 Top Specials', description: 'Top-ranked special episodes' },
  {
    value: 'bypopularity',
    label: '🔥 Most Popular',
    description: 'Ranked by MyAnimeList popularity',
  },
  { value: 'favorite', label: '❤️ Most Favorited', description: 'Ranked by user favorites' },
] as const;

export const MAL_SORT_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'members', label: 'Members' },
] as const;

export const MAL_ORDER_BY_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'scored_by', label: 'Scored By' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'rank', label: 'Rank' },
  { value: 'members', label: 'Members' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'end_date', label: 'End Date' },
  { value: 'episodes', label: 'Episodes' },
  { value: 'title', label: 'Title' },
] as const;

export const MAL_MEDIA_TYPES = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movie' },
  { value: 'ova', label: 'OVA' },
  { value: 'ona', label: 'ONA' },
  { value: 'special', label: 'Special' },
  { value: 'music', label: 'Music' },
] as const;

export const MAL_STATUSES = [
  { value: 'airing', label: 'Airing' },
  { value: 'complete', label: 'Finished' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

export const MAL_RATINGS = [
  { value: 'g', label: 'G - All Ages' },
  { value: 'pg', label: 'PG - Children' },
  { value: 'pg13', label: 'PG-13 - Teens 13+' },
  { value: 'r17', label: 'R - 17+' },
  { value: 'r', label: 'R+ - Mild Nudity' },
  { value: 'rx', label: 'Rx - Hentai' },
] as const;

// Categorized per Jikan's /v4/genres/anime?filter= buckets (genres/explicit_genres/themes/demographics).
// `explicit` genres are a subset of `genre` (Ecchi, Erotica, Hentai) - Jikan lists them in both.
export const MAL_GENRES: Array<{
  id: number;
  name: string;
  category: 'genre' | 'explicit' | 'theme' | 'demographic';
}> = [
  { id: 1, name: 'Action', category: 'genre' },
  { id: 2, name: 'Adventure', category: 'genre' },
  { id: 5, name: 'Avant Garde', category: 'genre' },
  { id: 46, name: 'Award Winning', category: 'genre' },
  { id: 28, name: 'Boys Love', category: 'genre' },
  { id: 4, name: 'Comedy', category: 'genre' },
  { id: 8, name: 'Drama', category: 'genre' },
  { id: 10, name: 'Fantasy', category: 'genre' },
  { id: 26, name: 'Girls Love', category: 'genre' },
  { id: 47, name: 'Gourmet', category: 'genre' },
  { id: 14, name: 'Horror', category: 'genre' },
  { id: 7, name: 'Mystery', category: 'genre' },
  { id: 22, name: 'Romance', category: 'genre' },
  { id: 24, name: 'Sci-Fi', category: 'genre' },
  { id: 36, name: 'Slice of Life', category: 'genre' },
  { id: 30, name: 'Sports', category: 'genre' },
  { id: 37, name: 'Supernatural', category: 'genre' },
  { id: 41, name: 'Suspense', category: 'genre' },
  { id: 9, name: 'Ecchi', category: 'explicit' },
  { id: 49, name: 'Erotica', category: 'explicit' },
  { id: 12, name: 'Hentai', category: 'explicit' },
  { id: 50, name: 'Adult Cast', category: 'theme' },
  { id: 51, name: 'Anthropomorphic', category: 'theme' },
  { id: 52, name: 'CGDCT', category: 'theme' },
  { id: 53, name: 'Childcare', category: 'theme' },
  { id: 54, name: 'Combat Sports', category: 'theme' },
  { id: 81, name: 'Crossdressing', category: 'theme' },
  { id: 55, name: 'Delinquents', category: 'theme' },
  { id: 39, name: 'Detective', category: 'theme' },
  { id: 56, name: 'Educational', category: 'theme' },
  { id: 57, name: 'Gag Humor', category: 'theme' },
  { id: 58, name: 'Gore', category: 'theme' },
  { id: 35, name: 'Harem', category: 'theme' },
  { id: 59, name: 'High Stakes Game', category: 'theme' },
  { id: 13, name: 'Historical', category: 'theme' },
  { id: 60, name: 'Idols (Female)', category: 'theme' },
  { id: 61, name: 'Idols (Male)', category: 'theme' },
  { id: 62, name: 'Isekai', category: 'theme' },
  { id: 63, name: 'Iyashikei', category: 'theme' },
  { id: 64, name: 'Love Polygon', category: 'theme' },
  { id: 74, name: 'Love Status Quo', category: 'theme' },
  { id: 65, name: 'Magical Sex Shift', category: 'theme' },
  { id: 66, name: 'Mahou Shoujo', category: 'theme' },
  { id: 17, name: 'Martial Arts', category: 'theme' },
  { id: 18, name: 'Mecha', category: 'theme' },
  { id: 67, name: 'Medical', category: 'theme' },
  { id: 38, name: 'Military', category: 'theme' },
  { id: 19, name: 'Music', category: 'theme' },
  { id: 6, name: 'Mythology', category: 'theme' },
  { id: 68, name: 'Organized Crime', category: 'theme' },
  { id: 69, name: 'Otaku Culture', category: 'theme' },
  { id: 20, name: 'Parody', category: 'theme' },
  { id: 70, name: 'Performing Arts', category: 'theme' },
  { id: 71, name: 'Pets', category: 'theme' },
  { id: 40, name: 'Psychological', category: 'theme' },
  { id: 3, name: 'Racing', category: 'theme' },
  { id: 72, name: 'Reincarnation', category: 'theme' },
  { id: 73, name: 'Reverse Harem', category: 'theme' },
  { id: 21, name: 'Samurai', category: 'theme' },
  { id: 23, name: 'School', category: 'theme' },
  { id: 75, name: 'Showbiz', category: 'theme' },
  { id: 29, name: 'Space', category: 'theme' },
  { id: 11, name: 'Strategy Game', category: 'theme' },
  { id: 31, name: 'Super Power', category: 'theme' },
  { id: 76, name: 'Survival', category: 'theme' },
  { id: 77, name: 'Team Sports', category: 'theme' },
  { id: 78, name: 'Time Travel', category: 'theme' },
  { id: 82, name: 'Urban Fantasy', category: 'theme' },
  { id: 32, name: 'Vampire', category: 'theme' },
  { id: 79, name: 'Video Game', category: 'theme' },
  { id: 83, name: 'Villainess', category: 'theme' },
  { id: 80, name: 'Visual Arts', category: 'theme' },
  { id: 48, name: 'Workplace', category: 'theme' },
  { id: 15, name: 'Kids', category: 'demographic' },
  { id: 42, name: 'Seinen', category: 'demographic' },
  { id: 25, name: 'Shoujo', category: 'demographic' },
  { id: 27, name: 'Shounen', category: 'demographic' },
  { id: 43, name: 'Josei', category: 'demographic' },
];

export const MAL_SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;
