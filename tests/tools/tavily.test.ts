import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCKED_DOMAINS,
  DEFAULT_RECENCY_DAYS,
  MAX_SEARCH_RESULTS,
  searchWeb,
} from '../../src/tools/tavily.ts';

const testToolOptions = {
  toolCallId: 'test',
  messages: [],
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string;
};

const executeSearch = async (
  input: { query: string; recencyDays?: number },
): Promise<SearchResult[]> => {
  if (!searchWeb.execute) {
    throw new Error('searchWeb.execute is not defined');
  }

  return (await searchWeb.execute(input, testToolOptions)) as SearchResult[];
};

const isWithinWindow = (publishedDate: string, recencyDays: number) => {
  const publishedAt = Date.parse(publishedDate);
  const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

  return Number.isFinite(publishedAt) && publishedAt >= cutoff;
};

if (!process.env.TAVILY_API_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}

describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');

    await expect(
      executeSearch({ query: 'protein content chicken breast' }),
    ).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe.skipIf(!process.env.TAVILY_API_KEY)('Tavily — real API', () => {
  it('returns non-empty dated results and uses the default recency window', async () => {
    const results = await executeSearch({ query: 'protein content chicken breast' });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => isWithinWindow(result.publishedDate, DEFAULT_RECENCY_DAYS))).toBe(
      true,
    );
  });

  it('returns only the public result fields', async () => {
    const results = await executeSearch({
      query: 'protein content chicken breast',
      recencyDays: 30,
    });

    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(['publishedDate', 'snippet', 'title', 'url']);
    }
  });

  it('excludes results without parseable dates and outside the requested window', async () => {
    const recencyDays = 7;
    const results = await executeSearch({
      query: 'protein content chicken breast',
      recencyDays,
    });

    expect(results.every((result) => isWithinWindow(result.publishedDate, recencyDays))).toBe(true);
  });

  it('caps results at MAX_SEARCH_RESULTS', async () => {
    const results = await executeSearch({
      query: 'latest nutrition and fitness research',
      recencyDays: 30,
    });

    expect(results.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
  });

  it('ships at least five blocked domains and excludes them from results', async () => {
    const blockedDomains = BLOCKED_DOMAINS as readonly string[];

    expect(blockedDomains.length).toBeGreaterThanOrEqual(5);

    const results = await executeSearch({
      query: 'protein supplements fitness nutrition',
      recencyDays: 30,
    });

    for (const result of results) {
      const hostname = new URL(result.url).hostname.toLowerCase();
      expect(blockedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))).toBe(
        false,
      );
    }
  });

  it('returns dated results from the news-topic request path', async () => {
    const results = await executeSearch({
      query: 'latest protein research',
      recencyDays: 30,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => Number.isFinite(Date.parse(result.publishedDate)))).toBe(true);
  });
});