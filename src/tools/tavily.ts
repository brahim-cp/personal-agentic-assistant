import { tool } from 'ai';
import { z } from 'zod';

export const DEFAULT_RECENCY_DAYS = 30;
export const MAX_SEARCH_RESULTS = 10;

export const BLOCKED_DOMAINS = [
	'allrecipes.com',
	'eatingwell.com',
	'food.com',
	'myfitnesspal.com',
	'supplementwarehouse.com',
	'bodybuilding.com',
] as const;

type TavilyResult = {
	title?: unknown;
	url?: unknown;
	content?: unknown;
	published_date?: unknown;
};

type TavilyResponse = {
	results?: unknown;
};

const isBlockedDomain = (url: string): boolean => {
	let hostname: string;

	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return true;
	}

	return BLOCKED_DOMAINS.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);
};

export const searchWeb = tool({
	description: 'Search the web for recent, factual health and lifestyle information.',
	inputSchema: z.object({
		query: z.string().min(1),
		recencyDays: z.number().int().positive().optional(),
	}),
	execute: async ({ query, recencyDays = DEFAULT_RECENCY_DAYS }) => {
		const apiKey = process.env.TAVILY_API_KEY;
		if (!apiKey) {
			throw new Error('TAVILY_API_KEY is required to search the web.');
		}

		const response = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				api_key: apiKey,
				query,
				topic: 'news',
				days: recencyDays,
				search_depth: 'basic',
				max_results: MAX_SEARCH_RESULTS,
			}),
		});

		if (!response.ok) {
			throw new Error(`Tavily search failed with HTTP ${response.status}.`);
		}

		const data = (await response.json()) as TavilyResponse;
		if (!Array.isArray(data.results)) {
			return [];
		}

		const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

		return data.results
			.filter((result): result is TavilyResult => typeof result === 'object' && result !== null)
			.filter((result) => {
				const publishedDate = typeof result.published_date === 'string'
					? result.published_date
					: '';

				return Number.isFinite(Date.parse(publishedDate))
					&& Date.parse(publishedDate) >= cutoff
					&& typeof result.title === 'string'
					&& typeof result.url === 'string'
					&& typeof result.content === 'string'
					&& !isBlockedDomain(result.url);
			})
			.slice(0, MAX_SEARCH_RESULTS)
			.map((result) => ({
				title: result.title as string,
				url: result.url as string,
				snippet: result.content as string,
				publishedDate: result.published_date as string,
			}));
	},
});
