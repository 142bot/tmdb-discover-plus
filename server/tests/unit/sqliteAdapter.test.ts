/**
 * Unit tests for SqliteAdapter against a real (temp-file) SQLite database.
 * No external services required — this is the only persistent adapter whose
 * full interface can be exercised without a database container.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteAdapter } from '../../src/services/storage/SqliteAdapter.ts';
import type { MarketplaceEntry, UserConfig } from '../../src/types/index.ts';

let dir: string;
let dbFile: string;
let adapter: SqliteAdapter;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-adapter-'));
  dbFile = path.join(dir, 'test.db');
  adapter = new SqliteAdapter(dbFile);
  await adapter.connect();
});

afterEach(async () => {
  await adapter.disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    userId: 'user-1',
    configName: 'Test Config',
    apiKeyId: 'key-1',
    catalogs: [],
    ...overrides,
  } as unknown as UserConfig;
}

function makeEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    marketplaceId: 'entry-1',
    provenance: { originUserId: 'user-1', originCatalogId: 'catalog-1' },
    name: 'Trending Sci-Fi',
    description: 'test entry',
    tags: ['sci-fi'],
    type: 'movie',
    source: 'tmdb',
    genres: ['Science Fiction'],
    filterFacets: [],
    filters: {},
    contentHash: 'hash-1',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    likes: 0,
    installs: 0,
    views: 0,
    trendingScore: 0,
    visibility: 'public',
    moderation: 'active',
    ...overrides,
  } as unknown as MarketplaceEntry;
}

describe('SqliteAdapter', () => {
  describe('user configs', () => {
    it('round-trips a saved config', async () => {
      await adapter.saveUserConfig(makeConfig());
      const loaded = await adapter.getUserConfig('user-1');
      expect(loaded?.userId).toBe('user-1');
      expect(loaded?.apiKeyId).toBe('key-1');
    });

    it('returns null for an unknown user', async () => {
      expect(await adapter.getUserConfig('nope')).toBeNull();
    });

    it('finds configs by api key id', async () => {
      await adapter.saveUserConfig(makeConfig());
      await adapter.saveUserConfig(makeConfig({ userId: 'user-2', apiKeyId: 'key-2' }));
      const byKey = await adapter.getConfigsByApiKeyId('key-1');
      expect(byKey).toHaveLength(1);
      expect(byKey[0].userId).toBe('user-1');
    });

    it('deletes a config', async () => {
      await adapter.saveUserConfig(makeConfig());
      expect(await adapter.deleteUserConfig('user-1')).toBe(true);
      expect(await adapter.getUserConfig('user-1')).toBeNull();
      expect(await adapter.deleteUserConfig('user-1')).toBe(false);
    });

    it('persists across reconnects', async () => {
      await adapter.saveUserConfig(makeConfig());
      await adapter.disconnect();
      adapter = new SqliteAdapter(dbFile);
      await adapter.connect();
      expect((await adapter.getUserConfig('user-1'))?.userId).toBe('user-1');
    });

    it('reports public stats with distinct api keys and catalog counts', async () => {
      await adapter.saveUserConfig(makeConfig());
      await adapter.saveUserConfig(makeConfig({ userId: 'user-2', apiKeyId: 'key-1' }));
      const stats = await adapter.getPublicStats();
      expect(stats.totalUsers).toBe(1);
      expect(stats.totalCatalogs).toBe(0);
    });
  });

  describe('marketplace entries', () => {
    it('upserts and reads an entry, reviving dates', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      const loaded = await adapter.getMarketplaceEntry('entry-1');
      expect(loaded?.name).toBe('Trending Sci-Fi');
      expect(loaded?.publishedAt).toBeInstanceOf(Date);
    });

    it('returns null for an unknown entry', async () => {
      expect(await adapter.getMarketplaceEntry('nope')).toBeNull();
    });

    it('deletes by origin', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      expect(await adapter.deleteMarketplaceEntryByOrigin('user-1', 'catalog-1')).toBe(true);
      expect(await adapter.getMarketplaceEntry('entry-1')).toBeNull();
    });

    it('finds public entries by fuzzy name query', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      const results = await adapter.searchMarketplaceEntries({ q: 'Trending Sci-Fi' });
      expect(results.map((e) => e.marketplaceId)).toContain('entry-1');
    });

    it('excludes non-public entries from search and count', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry({ visibility: 'private' }));
      expect(await adapter.searchMarketplaceEntries({})).toHaveLength(0);
      expect(await adapter.countMarketplaceEntries({})).toBe(0);
    });

    it('increments counters and floors them at zero', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      expect(await adapter.incrementMarketplaceCounter('entry-1', 'installs', 1)).toBe(1);
      expect(await adapter.incrementMarketplaceCounter('entry-1', 'installs', -1)).toBe(0);
      expect(await adapter.incrementMarketplaceCounter('entry-1', 'installs', -1)).toBe(0);
    });

    it('rejects unknown counter fields', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      await expect(
        adapter.incrementMarketplaceCounter('entry-1', 'bogus' as 'installs', 1)
      ).rejects.toThrow('unknown counter field');
    });

    it('sets the trending score', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      expect(await adapter.setTrendingScore('entry-1', 4.5)).toBe(4.5);
    });

    it('tracks likes per actor, idempotently', async () => {
      await adapter.upsertMarketplaceEntry(makeEntry());
      expect(await adapter.hasLiked('entry-1', 'user-9')).toBe(false);
      expect(await adapter.recordLike('entry-1', 'user-9')).toBe(true);
      expect(await adapter.recordLike('entry-1', 'user-9')).toBe(false);
      expect(await adapter.hasLiked('entry-1', 'user-9')).toBe(true);
      expect(await adapter.removeLike('entry-1', 'user-9')).toBe(true);
      expect(await adapter.hasLiked('entry-1', 'user-9')).toBe(false);
    });
  });
});
