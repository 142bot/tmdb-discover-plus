/**
 * SQLite storage adapter (better-sqlite3).
 *
 * Embedded, file-backed adapter for self-hosted single-process deployments:
 * no external database service is required — all state lives in one database
 * file, intended to sit on a mounted volume. WAL mode permits concurrent
 * reads during writes.
 *
 * Marketplace search intentionally reuses the shared in-process pipeline
 * (matchesFacets / nameSimilarity / resolveSort / sortMatches / clampLimit
 * from searchHelpers.ts), so ranking behaviour is identical to the Memory
 * and Mongo adapters and the cross-adapter equivalence suite applies
 * unchanged. Recall is gated by nameSimilarity >= FUZZY_THRESHOLD, exactly
 * as in those adapters.
 *
 * Optional follow-up: an FTS5 trigram virtual table over name/description
 * can serve as an indexed recall pre-filter ahead of JS scoring, narrowing
 * the candidate set for large marketplaces without changing semantics.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING } from '../../constants.ts';
import {
  clampLimit,
  matchesFacets,
  nameSimilarity,
  resolveSort,
  sortMatches,
} from './searchHelpers.ts';
import type {
  IStorageAdapter,
  MarketplaceEntry,
  MarketplaceSearchParams,
  PublicStats,
  UserConfig,
} from '../../types/index.ts';

const log = createLogger('Storage:SQLite');

const { FUZZY_THRESHOLD } = MARKETPLACE_RANKING;

/** Allow-list for counter columns interpolated into UPDATE statements. */
const COUNTER_FIELDS: ReadonlySet<string> = new Set(['installs', 'likes', 'views']);

type CounterField = 'installs' | 'likes' | 'views';

interface DataRow {
  data: string;
}

interface CountRow {
  count: number;
}

export class SqliteAdapter implements IStorageAdapter {
  private db: Database.Database | null = null;

  constructor(private readonly filePath: string) {}

  async connect(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new Database(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_configs (
        user_id    TEXT PRIMARY KEY,
        api_key_id TEXT,
        data       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_configs_api_key_id
        ON user_configs(api_key_id);

      CREATE TABLE IF NOT EXISTS marketplace_entries (
        marketplace_id    TEXT PRIMARY KEY,
        origin_user_id    TEXT NOT NULL,
        origin_catalog_id TEXT NOT NULL,
        name              TEXT NOT NULL,
        type              TEXT NOT NULL,
        source            TEXT NOT NULL,
        visibility        TEXT NOT NULL DEFAULT 'private',
        moderation        TEXT NOT NULL DEFAULT 'active',
        likes             INTEGER NOT NULL DEFAULT 0,
        installs          INTEGER NOT NULL DEFAULT 0,
        views             INTEGER NOT NULL DEFAULT 0,
        trending_score    REAL NOT NULL DEFAULT 0,
        data              TEXT NOT NULL,
        UNIQUE (origin_user_id, origin_catalog_id)
      );

      CREATE TABLE IF NOT EXISTS marketplace_likes (
        marketplace_id TEXT NOT NULL
          REFERENCES marketplace_entries(marketplace_id) ON DELETE CASCADE,
        user_id        TEXT NOT NULL,
        PRIMARY KEY (marketplace_id, user_id)
      );
    `);
    log.info('Connected to SQLite and verified schema', { file: this.filePath });
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  /** Narrowed handle: every public method requires connect() first. */
  private get handle(): Database.Database {
    if (!this.db) {
      throw new Error('SqliteAdapter: connect() must be called before use');
    }
    return this.db;
  }

  private static parseEntry(row: DataRow): MarketplaceEntry {
    const entry = JSON.parse(row.data) as MarketplaceEntry;
    // JSON stores Dates as ISO strings; revive them (mirrors Postgres JSONB mapping).
    if (entry.publishedAt) entry.publishedAt = new Date(entry.publishedAt);
    if (entry.updatedAt) entry.updatedAt = new Date(entry.updatedAt);
    if (entry.lastEngagedAt) entry.lastEngagedAt = new Date(entry.lastEngagedAt);
    return entry;
  }

  // --- User configs ---

  async getUserConfig(userId: string): Promise<UserConfig | null> {
    const row = this.handle
      .prepare('SELECT data FROM user_configs WHERE user_id = ?')
      .get(userId) as DataRow | undefined;
    return row ? (JSON.parse(row.data) as UserConfig) : null;
  }

  async saveUserConfig(config: UserConfig): Promise<UserConfig> {
    this.handle
      .prepare(
        `INSERT INTO user_configs (user_id, api_key_id, data)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           api_key_id = excluded.api_key_id,
           data       = excluded.data`
      )
      .run(config.userId, config.apiKeyId ?? null, JSON.stringify(config));
    return config;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]> {
    const rows = this.handle
      .prepare('SELECT data FROM user_configs WHERE api_key_id = ?')
      .all(apiKeyId) as DataRow[];
    return rows.map((row) => JSON.parse(row.data) as UserConfig);
  }

  async getAllConfigs(): Promise<UserConfig[]> {
    const rows = this.handle.prepare('SELECT data FROM user_configs').all() as DataRow[];
    return rows.map((row) => JSON.parse(row.data) as UserConfig);
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    const info = this.handle
      .prepare('DELETE FROM user_configs WHERE user_id = ?')
      .run(userId);
    return info.changes > 0;
  }

  async getPublicStats(): Promise<PublicStats> {
    const users = this.handle
      .prepare('SELECT COUNT(DISTINCT api_key_id) AS count FROM user_configs')
      .get() as CountRow;
    const rows = this.handle.prepare('SELECT data FROM user_configs').all() as DataRow[];
    let totalCatalogs = 0;
    for (const row of rows) {
      const config = JSON.parse(row.data) as UserConfig;
      totalCatalogs += config.catalogs?.length ?? 0;
    }
    return { totalUsers: users.count, totalCatalogs };
  }

  // --- Marketplace persistence ---

  async upsertMarketplaceEntry(entry: MarketplaceEntry): Promise<MarketplaceEntry> {
    this.handle
      .prepare(
        `INSERT INTO marketplace_entries (
           marketplace_id, origin_user_id, origin_catalog_id,
           name, type, source, visibility, moderation,
           likes, installs, views, trending_score, data
         ) VALUES (
           @marketplaceId, @originUserId, @originCatalogId,
           @name, @type, @source, @visibility, @moderation,
           @likes, @installs, @views, @trendingScore, @data
         )
         ON CONFLICT(marketplace_id) DO UPDATE SET
           name           = excluded.name,
           type           = excluded.type,
           source         = excluded.source,
           visibility     = excluded.visibility,
           moderation     = excluded.moderation,
           likes          = excluded.likes,
           installs       = excluded.installs,
           views          = excluded.views,
           trending_score = excluded.trending_score,
           data           = excluded.data`
      )
      .run({
        marketplaceId: entry.marketplaceId,
        originUserId: entry.provenance.originUserId,
        originCatalogId: entry.provenance.originCatalogId,
        name: entry.name,
        type: entry.type,
        source: entry.source,
        visibility: entry.visibility ?? 'private',
        moderation: entry.moderation ?? 'active',
        likes: entry.likes ?? 0,
        installs: entry.installs ?? 0,
        views: entry.views ?? 0,
        trendingScore: entry.trendingScore ?? 0,
        data: JSON.stringify(entry),
      });
    return entry;
  }

  async deleteMarketplaceEntryByOrigin(
    originUserId: string,
    originCatalogId: string
  ): Promise<boolean> {
    const info = this.handle
      .prepare(
        'DELETE FROM marketplace_entries WHERE origin_user_id = ? AND origin_catalog_id = ?'
      )
      .run(originUserId, originCatalogId);
    return info.changes > 0;
  }

  async getMarketplaceEntry(marketplaceId: string): Promise<MarketplaceEntry | null> {
    const row = this.handle
      .prepare('SELECT data FROM marketplace_entries WHERE marketplace_id = ?')
      .get(marketplaceId) as DataRow | undefined;
    return row ? SqliteAdapter.parseEntry(row) : null;
  }

  /**
   * Public + active rows filtered by facets and fuzzy name match — the same
   * selection the Memory and Mongo adapters perform.
   */
  private selectMatches(params: MarketplaceSearchParams, query: string): MarketplaceEntry[] {
    const rows = this.handle
      .prepare(
        `SELECT data FROM marketplace_entries
         WHERE visibility = 'public' AND moderation = 'active'`
      )
      .all() as DataRow[];
    const out: MarketplaceEntry[] = [];
    for (const row of rows) {
      const entry = SqliteAdapter.parseEntry(row);
      if (!matchesFacets(entry, params.facets)) continue;
      if (query && nameSimilarity(entry.name, query) < FUZZY_THRESHOLD) continue;
      out.push(entry);
    }
    return out;
  }

  async searchMarketplaceEntries(
    params: MarketplaceSearchParams
  ): Promise<MarketplaceEntry[]> {
    const query = (params.q ?? '').trim();
    const matched = this.selectMatches(params, query);
    const sort = resolveSort(params.sort, query.length > 0);
    const sorted = sortMatches(matched, sort, query);
    const limit = clampLimit(params.limit);
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const start = (page - 1) * limit;
    return sorted.slice(start, start + limit);
  }

  async countMarketplaceEntries(params: MarketplaceSearchParams): Promise<number> {
    const query = (params.q ?? '').trim();
    return this.selectMatches(params, query).length;
  }

  async incrementMarketplaceCounter(
    marketplaceId: string,
    field: CounterField,
    delta: 1 | -1
  ): Promise<number> {
    if (!COUNTER_FIELDS.has(field)) {
      throw new Error(`SqliteAdapter: unknown counter field "${field}"`);
    }
    const row = this.handle
      .prepare(
        `UPDATE marketplace_entries
         SET ${field} = MAX(0, ${field} + ?)
         WHERE marketplace_id = ?
         RETURNING ${field} AS value`
      )
      .get(delta, marketplaceId) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  async setTrendingScore(marketplaceId: string, score: number): Promise<number> {
    const row = this.handle
      .prepare(
        `UPDATE marketplace_entries
         SET trending_score = ?
         WHERE marketplace_id = ?
         RETURNING trending_score AS value`
      )
      .get(score, marketplaceId) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  // --- Likes ---

  async recordLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const info = this.handle
      .prepare('INSERT OR IGNORE INTO marketplace_likes (marketplace_id, user_id) VALUES (?, ?)')
      .run(marketplaceId, actorUserId);
    return info.changes > 0;
  }

  async removeLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const info = this.handle
      .prepare('DELETE FROM marketplace_likes WHERE marketplace_id = ? AND user_id = ?')
      .run(marketplaceId, actorUserId);
    return info.changes > 0;
  }

  async hasLiked(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const row = this.handle
      .prepare(
        'SELECT 1 AS found FROM marketplace_likes WHERE marketplace_id = ? AND user_id = ? LIMIT 1'
      )
      .get(marketplaceId, actorUserId);
    return row !== undefined;
  }
}
