import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  deleteProfileByUserKey,
  getNotionMcp,
  getProfileByUserKey,
  upsertProfile,
} from '../../src/tools/notion.ts';

const REQUIRED_ENV_VARS = [
  'NOTION_API_KEY',
  'NOTION_PROFILE_DB_ID',
  'NOTION_NUTRITION_DB_ID',
  'NOTION_RECIPES_DB_ID',
  'NOTION_MEALPLANS_DB_ID',
  'NOTION_WORKOUTS_DB_ID',
  'NOTION_LOGS_DB_ID',
] as const;

const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
const HAS_NOTION_ENV = missingEnvVars.length === 0;

if (!HAS_NOTION_ENV) {
  console.warn(
    `[skip] ${missingEnvVars.join(', ')} unset — Notion real-API suite skipped`,
  );
}

const NOTION_TOOL_NAMES = [
  'notion-search',
  'notion-fetch',
  'notion-create-pages',
  'notion-update-page',
] as const;

const TEST_USER_KEY = 'notion-integration-test-2026-08-21';
const TEST_PROFILE = {
  userKey: TEST_USER_KEY,
  ageYears: 30,
  sex: 'other' as const,
  weightKg: 80,
  heightCm: 180,
  activityLevel: 'moderate' as const,
  goal: 'maintain' as const,
  restrictions: ['no shellfish'],
  equipment: ['dumbbells'],
  limitations: ['none'],
};

type NotionClient = Awaited<ReturnType<typeof getNotionMcp>>;

let client: NotionClient | undefined;
let profileWasWritten = false;

const closeQuietly = async () => {
  if (!client) {
    return;
  }

  try {
    await client.close();
  } catch (error) {
    console.warn('[cleanup] failed to close Notion MCP client', error);
  }
};

describe('Notion — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const envName of REQUIRED_ENV_VARS) {
    it(`throws an actionable error naming ${envName}`, async () => {
      for (const requiredEnvName of REQUIRED_ENV_VARS) {
        vi.stubEnv(requiredEnvName, requiredEnvName === envName ? '' : 'test-value');
      }

      await expect(getNotionMcp()).rejects.toThrow(new RegExp(envName));
    });
  }
});

describe.skipIf(!HAS_NOTION_ENV)('Notion — connector', () => {
  beforeAll(async () => {
    client = await getNotionMcp();
  }, 60_000);

  afterAll(async () => {
    if (profileWasWritten && client) {
      try {
        await deleteProfileByUserKey(client, TEST_USER_KEY);
      } catch (error) {
        console.warn('[cleanup] failed to delete Notion test profile', error);
      }
    }

    await closeQuietly();
  }, 60_000);

  it('connects to the hosted MCP and exposes the exact CRUD primitives', async () => {
    expect(client).toBeDefined();

    const tools = await client!.tools();
    expect(Object.keys(tools)).toEqual(expect.arrayContaining([...NOTION_TOOL_NAMES]));
    expect(Object.keys(tools).filter((name) => /notion/i.test(name))).toEqual(
      expect.arrayContaining([...NOTION_TOOL_NAMES]),
    );

    for (const toolName of NOTION_TOOL_NAMES) {
      expect(tools[toolName]).toBeDefined();
      expect(tools[toolName].execute).toBeTypeOf('function');
    }
  });

  it('writes and reads a row through a structured primary-field filter', async () => {
    await upsertProfile(client!, TEST_PROFILE);
    profileWasWritten = true;

    const row = await getProfileByUserKey(client!, TEST_USER_KEY);

    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      userKey: TEST_USER_KEY,
      restrictions: TEST_PROFILE.restrictions,
    });
  });

  it('reads written property values by Notion property ID', async () => {
    await upsertProfile(client!, TEST_PROFILE);
    profileWasWritten = true;

    const tools = await client!.tools();
    const fetchPage = tools['notion-fetch'];
    expect(fetchPage).toBeDefined();

    const row = await getProfileByUserKey(client!, TEST_USER_KEY);
    expect(row).toMatchObject({ userKey: TEST_USER_KEY });

    const pageId = (row as { id?: string }).id;
    expect(pageId).toBeTypeOf('string');

    const fetched = await fetchPage.execute!({ id: pageId }, {} as never);
    expect(fetched).not.toMatchObject({ isError: true });

    const page = fetched as {
      properties?: Record<string, { id?: string; title?: Array<{ plain_text?: string }> }>;
    };
    const properties = Object.values(page.properties ?? {});
    const userKeyProperty = properties.find((property) =>
      property.title?.some((value) => value.plain_text === TEST_USER_KEY),
    );

    expect(userKeyProperty?.id).toBeTypeOf('string');
    expect(userKeyProperty?.id).not.toBe('userKey');
    expect(row).toHaveProperty('userKey', TEST_USER_KEY);
  });

  it('throws when an MCP call returns an error envelope instead of hollow success', async () => {
    await expect(
      upsertProfile(client!, {
        ...TEST_PROFILE,
        ageYears: 0,
      }),
    ).rejects.toThrow();
  });

  it('closes the MCP connection cleanly', async () => {
    const disposableClient = await getNotionMcp();

    await expect(disposableClient.close()).resolves.toBeUndefined();
  });
});
