import { experimental_createMCPClient } from '@ai-sdk/mcp';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

const TOOL_NAMES = {
	search: 'notion-search',
	fetch: 'notion-fetch',
	create: 'notion-create-pages',
	update: 'notion-update-page',
} as const;

const DATABASE_ENV_NAMES = {
	profile: 'NOTION_PROFILE_DB_ID',
	nutrition: 'NOTION_NUTRITION_DB_ID',
	recipes: 'NOTION_RECIPES_DB_ID',
	mealPlans: 'NOTION_MEALPLANS_DB_ID',
	workouts: 'NOTION_WORKOUTS_DB_ID',
	logs: 'NOTION_LOGS_DB_ID',
} as const;

type NotionClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;
type JsonObject = Record<string, unknown>;
type PropertyDefinition = { id: string; type?: string; name?: string };
type PropertyDefinitions = Record<string, PropertyDefinition>;
type NotionProperty = {
	id?: string;
	type?: string;
	title?: Array<{ plain_text?: string; text?: { content?: string } }>;
	rich_text?: Array<{ plain_text?: string; text?: { content?: string } }>;
	number?: number | null;
	select?: { name?: string } | null;
	multi_select?: Array<{ name?: string }>;
	date?: { start?: string } | null;
	relation?: Array<{ id?: string }>;
};

export type ProfileRow = {
	id?: string;
	userKey: string;
	ageYears: number;
	sex: 'female' | 'male' | 'other';
	weightKg: number;
	heightCm: number;
	activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
	goal: 'lose' | 'maintain' | 'gain';
	restrictions: string[];
	equipment: string[];
	limitations: string[];
};

export type NutritionTargetsRow = {
	id?: string;
	date: string;
	dailyCalories: number;
	proteinG: number;
	fatG: number;
	carbG: number;
	bmr: number;
	tdee: number;
	reasoning: string;
};

export type RecipeRow = {
	id?: string;
	name: string;
	prepMinutes: number;
	ingredients: string;
	steps: string;
	approxCalories: number;
	proteinG: number;
	fatG: number;
	carbG: number;
};

export type MealPlanRow = {
	id?: string;
	week: string;
	recipes: string[];
	groceryList: string;
};

export type WorkoutRow = {
	id?: string;
	name: string;
	date: string;
	durationMinutes: number;
	exercises: string;
	intensity: 'easy' | 'moderate' | 'hard';
};

export type LogRow = {
	id?: string;
	entry: string;
	date: string;
	type: 'meal' | 'workout';
	payload: string;
	notes: string;
};

const schemaCache = new WeakMap<object, Map<string, PropertyDefinitions>>();

const requireEnv = (name: string): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required for the Notion integration`);
	}

	return value;
};

const asObject = (value: unknown): JsonObject => {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as JsonObject;
	}

	return {};
};

const parseTextResult = (value: unknown): unknown => {
	const result = asObject(value);

	if (result.isError === true) {
		throw new Error(`Notion MCP call failed: ${JSON.stringify(result)}`);
	}

	if (result.structuredContent !== undefined) {
		return result.structuredContent;
	}

	const content = Array.isArray(result.content) ? result.content : [];
	const text = content.find((item) => asObject(item).type === 'text');
	const textValue = text ? asObject(text).text : undefined;

	if (typeof textValue === 'string') {
		try {
			return JSON.parse(textValue);
		} catch {
			return textValue;
		}
	}

	return value;
};

const callTool = async (
	client: NotionClient,
	name: string,
	input: JsonObject,
): Promise<unknown> => {
	const tools = await client.tools();
	const tool = tools[name];
	if (!tool || typeof tool.execute !== 'function') {
		throw new Error(`Required Notion MCP tool is unavailable: ${name}`);
	}

	const result = await tool.execute(input, {
		toolCallId: `notion-wrapper-${name}`,
		messages: [],
	} as never);

	return parseTextResult(result);
};

const getPropertyDefinitions = async (
	client: NotionClient,
	databaseId: string,
): Promise<PropertyDefinitions> => {
	let clientCache = schemaCache.get(client);
	if (!clientCache) {
		clientCache = new Map();
		schemaCache.set(client, clientCache);
	}

	const cached = clientCache.get(databaseId);
	if (cached) {
		return cached;
	}

	const fetched = asObject(await callTool(client, TOOL_NAMES.fetch, { id: databaseId }));
	const database = asObject(fetched.data_source ?? fetched.database ?? fetched);
	const rawProperties = asObject(database.properties);
	const definitions: PropertyDefinitions = {};

	for (const [displayName, value] of Object.entries(rawProperties)) {
		const property = asObject(value);
		if (typeof property.id === 'string') {
			definitions[displayName] = {
				id: property.id,
				name: displayName,
				type: typeof property.type === 'string' ? property.type : undefined,
			};
		}
	}

	if (Object.keys(definitions).length === 0) {
		throw new Error(`Notion database ${databaseId} returned no property schema`);
	}

	clientCache.set(databaseId, definitions);
	return definitions;
};

const property = (
	definitions: PropertyDefinitions,
	name: string,
): PropertyDefinition => {
	const definition = definitions[name];
	if (!definition) {
		throw new Error(`Notion property ${name} was not found in the database schema`);
	}

	return definition;
};

const titleValue = (value: string) => ({
	title: [{ type: 'text', text: { content: value } }],
});

const richTextValue = (value: string) => ({
	rich_text: [{ type: 'text', text: { content: value } }],
});

const selectValue = (value: string) => ({ select: { name: value } });

const multiSelectValue = (value: string[]) => ({
	multi_select: value.map((name) => ({ name })),
});

const numberValue = (value: number) => ({ number: value });

const dateValue = (value: string) => ({ date: { start: value } });

const relationValue = (value: string[]) => ({
	relation: value.map((id) => ({ id })),
});

const createProperties = (
	definitions: PropertyDefinitions,
	values: Record<string, unknown>,
): JsonObject => {
	const result: JsonObject = {};
	for (const [name, value] of Object.entries(values)) {
		const definition = property(definitions, name);
		result[definition.id] = value;
	}

	return result;
};

const readProperty = (
	pageProperties: JsonObject,
	definitions: PropertyDefinitions,
	name: string,
): NotionProperty => {
	const definition = property(definitions, name);
	const byId = Object.values(pageProperties).find((value) =>
		asObject(value).id === definition.id,
	);

	if (!byId) {
		throw new Error(`Notion page is missing property ID ${definition.id} for ${name}`);
	}

	return byId as NotionProperty;
};

const readText = (value: NotionProperty): string => {
	const items = value.title ?? value.rich_text ?? [];
	return items.map((item) => item.plain_text ?? item.text?.content ?? '').join('');
};

const readNumber = (value: NotionProperty): number => value.number ?? 0;

const readSelect = (value: NotionProperty): string => value.select?.name ?? '';

const readMultiSelect = (value: NotionProperty): string[] =>
	(value.multi_select ?? []).flatMap((item) => (item.name ? [item.name] : []));

const readDate = (value: NotionProperty): string => value.date?.start ?? '';

const readRelation = (value: NotionProperty): string[] =>
	(value.relation ?? []).flatMap((item) => (item.id ? [item.id] : []));

const pageRecords = (value: unknown): JsonObject[] => {
	const object = asObject(value);
	const records = object.records ?? object.pages ?? object.results ?? object.data;
	if (Array.isArray(records)) {
		return records.map(asObject);
	}

	if (object.id) {
		return [object];
	}

	return [];
};

const pageId = (page: JsonObject): string => {
	if (typeof page.id !== 'string') {
		throw new Error('Notion MCP response did not include a page ID');
	}

	return page.id;
};

const findByPrimaryKey = async (
	client: NotionClient,
	databaseId: string,
	primaryName: string,
	key: string,
): Promise<{ page: JsonObject; definitions: PropertyDefinitions } | null> => {
	const definitions = await getPropertyDefinitions(client, databaseId);
	const primary = property(definitions, primaryName);
	const response = await callTool(client, TOOL_NAMES.search, {
		database_id: databaseId,
		filter: {
			property: primary.id,
			title: { equals: key },
		},
		query: key,
	});
	const page = pageRecords(response)[0];

	return page ? { page, definitions } : null;
};

const writeRow = async (
	client: NotionClient,
	databaseId: string,
	primaryName: string,
	primaryValue: string,
	values: Record<string, unknown>,
): Promise<string> => {
	const existing = await findByPrimaryKey(client, databaseId, primaryName, primaryValue);
	const properties = createProperties(existing?.definitions ?? await getPropertyDefinitions(client, databaseId), values);

	if (existing) {
		const response = await callTool(client, TOOL_NAMES.update, {
			page_id: pageId(existing.page),
			properties,
		});
		const updatedPage = asObject(asObject(response).page ?? response);
		return pageId(updatedPage);
	}

	const response = await callTool(client, TOOL_NAMES.create, {
		parent: { database_id: databaseId },
		records: [{ properties }],
	});
	return pageId(pageRecords(response)[0] ?? asObject(response).page ?? {});
};

const deleteRow = async (
	client: NotionClient,
	databaseId: string,
	primaryName: string,
	key: string,
): Promise<number> => {
	const existing = await findByPrimaryKey(client, databaseId, primaryName, key);
	if (!existing) {
		return 0;
	}

	await callTool(client, TOOL_NAMES.update, {
		page_id: pageId(existing.page),
		archived: true,
	});
	return 1;
};

const profileFromPage = (
	page: JsonObject,
	definitions: PropertyDefinitions,
): ProfileRow => {
	const properties = asObject(page.properties);
	return {
		id: typeof page.id === 'string' ? page.id : undefined,
		userKey: readText(readProperty(properties, definitions, 'userKey')),
		ageYears: readNumber(readProperty(properties, definitions, 'ageYears')),
		sex: readSelect(readProperty(properties, definitions, 'sex')) as ProfileRow['sex'],
		weightKg: readNumber(readProperty(properties, definitions, 'weightKg')),
		heightCm: readNumber(readProperty(properties, definitions, 'heightCm')),
		activityLevel: readSelect(readProperty(properties, definitions, 'activityLevel')) as ProfileRow['activityLevel'],
		goal: readSelect(readProperty(properties, definitions, 'goal')) as ProfileRow['goal'],
		restrictions: readMultiSelect(readProperty(properties, definitions, 'restrictions')),
		equipment: readMultiSelect(readProperty(properties, definitions, 'equipment')),
		limitations: readMultiSelect(readProperty(properties, definitions, 'limitations')),
	};
};

const validateProfile = (row: ProfileRow): void => {
	if (!row.userKey || row.ageYears <= 0 || row.weightKg <= 0 || row.heightCm <= 0) {
		throw new Error('Invalid Notion profile row');
	}
};

export const getNotionMcp = async (): Promise<NotionClient> => {
	const apiKey = requireEnv('NOTION_API_KEY');
	for (const envName of Object.values(DATABASE_ENV_NAMES)) {
		requireEnv(envName);
	}

	const client = await experimental_createMCPClient({
		transport: {
			type: 'http',
			url: NOTION_MCP_URL,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Notion-Version': '2022-06-28',
			},
		},
		name: 'personal-agentic-assistant-notion',
		version: '1.0.0',
	});

	const tools = await client.tools();
	for (const toolName of Object.values(TOOL_NAMES)) {
		if (!tools[toolName] || typeof tools[toolName].execute !== 'function') {
			await client.close();
			throw new Error(`Required Notion MCP tool is unavailable: ${toolName}`);
		}
	}

	return client;
};

export const upsertProfile = async (
	client: NotionClient,
	row: ProfileRow,
): Promise<ProfileRow> => {
	validateProfile(row);
	const databaseId = requireEnv(DATABASE_ENV_NAMES.profile);
	const id = await writeRow(client, databaseId, 'userKey', row.userKey, {
		userKey: titleValue(row.userKey),
		ageYears: numberValue(row.ageYears),
		sex: selectValue(row.sex),
		weightKg: numberValue(row.weightKg),
		heightCm: numberValue(row.heightCm),
		activityLevel: selectValue(row.activityLevel),
		goal: selectValue(row.goal),
		restrictions: multiSelectValue(row.restrictions),
		equipment: multiSelectValue(row.equipment),
		limitations: multiSelectValue(row.limitations),
	});
	return { ...row, id };
};

export const getProfileByUserKey = async (
	client: NotionClient,
	userKey: string,
): Promise<ProfileRow | null> => {
	const databaseId = requireEnv(DATABASE_ENV_NAMES.profile);
	const found = await findByPrimaryKey(client, databaseId, 'userKey', userKey);
	return found ? profileFromPage(found.page, found.definitions) : null;
};

export const deleteProfileByUserKey = (
	client: NotionClient,
	userKey: string,
): Promise<number> =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.profile), 'userKey', userKey);

const genericUpsert = <T extends Record<string, unknown>>(
	client: NotionClient,
	databaseEnv: string,
	primaryName: string,
	primaryValue: string,
	values: Record<string, unknown>,
): Promise<string> =>
	writeRow(client, requireEnv(databaseEnv), primaryName, primaryValue, values);

export const upsertNutritionTargets = (client: NotionClient, row: NutritionTargetsRow) =>
	genericUpsert(client, DATABASE_ENV_NAMES.nutrition, 'date', row.date, {
		date: titleValue(row.date), dailyCalories: numberValue(row.dailyCalories), proteinG: numberValue(row.proteinG),
		fatG: numberValue(row.fatG), carbG: numberValue(row.carbG), bmr: numberValue(row.bmr), tdee: numberValue(row.tdee),
		reasoning: richTextValue(row.reasoning),
	});

export const getNutritionTargetsByDate = (client: NotionClient, key: string) =>
	findByPrimaryKey(client, requireEnv(DATABASE_ENV_NAMES.nutrition), 'date', key);

export const deleteNutritionTargetsByDate = (client: NotionClient, key: string) =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.nutrition), 'date', key);

export const upsertRecipe = (client: NotionClient, row: RecipeRow) =>
	genericUpsert(client, DATABASE_ENV_NAMES.recipes, 'name', row.name, {
		name: titleValue(row.name), prepMinutes: numberValue(row.prepMinutes), ingredients: richTextValue(row.ingredients),
		steps: richTextValue(row.steps), approxCalories: numberValue(row.approxCalories), proteinG: numberValue(row.proteinG),
		fatG: numberValue(row.fatG), carbG: numberValue(row.carbG),
	});

export const getRecipeByName = (client: NotionClient, key: string) =>
	findByPrimaryKey(client, requireEnv(DATABASE_ENV_NAMES.recipes), 'name', key);

export const deleteRecipeByName = (client: NotionClient, key: string) =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.recipes), 'name', key);

export const upsertMealPlan = (client: NotionClient, row: MealPlanRow) =>
	genericUpsert(client, DATABASE_ENV_NAMES.mealPlans, 'week', row.week, {
		week: titleValue(row.week), recipes: relationValue(row.recipes), groceryList: richTextValue(row.groceryList),
	});

export const getMealPlanByWeek = (client: NotionClient, key: string) =>
	findByPrimaryKey(client, requireEnv(DATABASE_ENV_NAMES.mealPlans), 'week', key);

export const deleteMealPlanByWeek = (client: NotionClient, key: string) =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.mealPlans), 'week', key);

export const upsertWorkout = (client: NotionClient, row: WorkoutRow) =>
	genericUpsert(client, DATABASE_ENV_NAMES.workouts, 'name', row.name, {
		name: titleValue(row.name), date: dateValue(row.date), durationMinutes: numberValue(row.durationMinutes),
		exercises: richTextValue(row.exercises), intensity: selectValue(row.intensity),
	});

export const getWorkoutByName = (client: NotionClient, key: string) =>
	findByPrimaryKey(client, requireEnv(DATABASE_ENV_NAMES.workouts), 'name', key);

export const deleteWorkoutByName = (client: NotionClient, key: string) =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.workouts), 'name', key);

export const upsertLog = (client: NotionClient, row: LogRow) =>
	genericUpsert(client, DATABASE_ENV_NAMES.logs, 'entry', row.entry, {
		entry: titleValue(row.entry), date: dateValue(row.date), type: selectValue(row.type),
		payload: richTextValue(row.payload), notes: richTextValue(row.notes),
	});

export const getLogByEntry = (client: NotionClient, key: string) =>
	findByPrimaryKey(client, requireEnv(DATABASE_ENV_NAMES.logs), 'entry', key);

export const deleteLogByEntry = (client: NotionClient, key: string) =>
	deleteRow(client, requireEnv(DATABASE_ENV_NAMES.logs), 'entry', key);
