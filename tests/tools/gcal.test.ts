import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createEvent,
  deleteEvent,
  getCalendarClient,
  listEvents,
  updateEvent,
} from '../../src/tools/gcal.ts';

const REQUIRED_ENV_VARS = [
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALENDAR_ID',
] as const;

const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
const HAS_GOOGLE_ENV = missingEnvVars.length === 0;

if (!HAS_GOOGLE_ENV) {
  console.warn(
    `[skip] ${missingEnvVars.join(', ')} unset — Google Calendar real-API suite skipped`,
  );
}

const EVENT_TITLE = 'personal-agentic-assistant gcal connector test';
const EVENT_START = '2026-09-15T14:00:00.000Z';
const EVENT_END = '2026-09-15T14:30:00.000Z';
const UPDATED_EVENT_TITLE = `${EVENT_TITLE} updated`;
const LIST_START = '2026-09-15T00:00:00.000Z';
const LIST_END = '2026-09-16T00:00:00.000Z';

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};

let calendarClient: Awaited<ReturnType<typeof getCalendarClient>> | undefined;
const createdEventIds = new Set<string>();
let lifecycleEventId: string | undefined;

const testEvent = {
  title: EVENT_TITLE,
  start: EVENT_START,
  end: EVENT_END,
};

describe('Google Calendar — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const envName of REQUIRED_ENV_VARS) {
    it(`throws an actionable error naming ${envName}`, async () => {
      for (const requiredEnvName of REQUIRED_ENV_VARS) {
        vi.stubEnv(requiredEnvName, requiredEnvName === envName ? '' : 'test-value');
      }

      await expect(getCalendarClient()).rejects.toThrow(new RegExp(envName));
    });
  }
});

describe.skipIf(!HAS_GOOGLE_ENV)('Google Calendar — gcal connector', () => {
  beforeAll(async () => {
    expect(process.env.GOOGLE_CALENDAR_ID).toBeTruthy();
    expect(process.env.GOOGLE_CALENDAR_ID).not.toBe('primary');

    calendarClient = await getCalendarClient();
  }, 60_000);

  afterAll(async () => {
    for (const eventId of createdEventIds) {
      try {
        await deleteEvent(eventId);
      } catch (error) {
        console.warn(`[cleanup] failed to delete Google Calendar event ${eventId}`, error);
      }
    }
  }, 60_000);

  it('authenticates with the OAuth desktop flow and uses the dedicated Assistant calendar', async () => {
    expect(calendarClient).toBeDefined();
    expect(process.env.GOOGLE_REFRESH_TOKEN).toBeTruthy();
    expect(process.env.GOOGLE_CLIENT_ID).toBeTruthy();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeTruthy();
    expect(process.env.GOOGLE_CALENDAR_ID).toBeTruthy();
    expect(process.env.GOOGLE_CALENDAR_ID).not.toBe('primary');
  });

  it('round-trips create and list with RFC 3339 start and end values', async () => {
    const created = await createEvent(testEvent);
    expect(created.id).toBeTypeOf('string');
    createdEventIds.add(created.id);
    lifecycleEventId = created.id;

    const events = (await listEvents(LIST_START, LIST_END)) as CalendarEvent[];
    const listed = events.find((event) => event.id === created.id);

    expect(listed).toMatchObject({
      id: created.id,
      title: EVENT_TITLE,
      start: EVENT_START,
      end: EVENT_END,
    });
    expect(Number.isFinite(Date.parse(listed!.start))).toBe(true);
    expect(Number.isFinite(Date.parse(listed!.end))).toBe(true);
    expect(listed!.start).toBe(EVENT_START);
    expect(listed!.end).toBe(EVENT_END);
  });

  it('updates and deletes the event by id, then no longer lists it', async () => {
    expect(lifecycleEventId).toBeTypeOf('string');

    const updated = await updateEvent(lifecycleEventId!, {
      title: UPDATED_EVENT_TITLE,
      start: EVENT_START,
      end: EVENT_END,
    });

    expect(updated).toMatchObject({
      id: lifecycleEventId,
      title: UPDATED_EVENT_TITLE,
      start: EVENT_START,
      end: EVENT_END,
    });

    const afterUpdate = (await listEvents(LIST_START, LIST_END)) as CalendarEvent[];
    expect(afterUpdate.find((event) => event.id === lifecycleEventId)).toMatchObject({
      id: lifecycleEventId,
      title: UPDATED_EVENT_TITLE,
    });

    await deleteEvent(lifecycleEventId!);

    const afterDelete = (await listEvents(LIST_START, LIST_END)) as CalendarEvent[];
    expect(afterDelete.some((event) => event.id === lifecycleEventId)).toBe(false);
  });
});
