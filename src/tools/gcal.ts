import { google, type calendar_v3 } from 'googleapis';

export type CalendarEvent = {
	id: string;
	title: string;
	start: string;
	end: string;
};

export type CalendarEventInput = {
	title: string;
	start: string;
	end: string;
};

export type CalendarEventPatch = Partial<CalendarEventInput>;

const requireEnv = (name: string): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required for the Google Calendar integration`);
	}

	return value;
};

const getCalendarId = (): string => {
	const calendarId = requireEnv('GOOGLE_CALENDAR_ID');
	if (calendarId === 'primary') {
		throw new Error('GOOGLE_CALENDAR_ID must identify the dedicated Assistant calendar, not primary');
	}

	return calendarId;
};

const assertRfc3339 = (value: string, fieldName: string): string => {
	if (!Number.isFinite(Date.parse(value)) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
		throw new Error(`${fieldName} must be an RFC 3339 datetime`);
	}

	return value;
};

const canonicalRfc3339 = (value: string, fieldName: string): string =>
	new Date(assertRfc3339(value, fieldName)).toISOString();

const toGoogleEvent = (event: CalendarEventInput): calendar_v3.Schema$Event => ({
	summary: event.title,
	start: { dateTime: assertRfc3339(event.start, 'start') },
	end: { dateTime: assertRfc3339(event.end, 'end') },
});

const fromGoogleEvent = (event: calendar_v3.Schema$Event): CalendarEvent => {
	if (!event.id) {
		throw new Error('Google Calendar response did not include an event ID');
	}

	const start = event.start?.dateTime;
	const end = event.end?.dateTime;
	if (!start || !end) {
		throw new Error('Google Calendar event did not include RFC 3339 start and end datetimes');
	}

	return {
		id: event.id,
		title: event.summary ?? '',
		start: canonicalRfc3339(start, 'start'),
		end: canonicalRfc3339(end, 'end'),
	};
};

export const getCalendarClient = async (): Promise<calendar_v3.Calendar> => {
	const clientId = requireEnv('GOOGLE_CLIENT_ID');
	const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
	const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
	getCalendarId();

	const auth = new google.auth.OAuth2(clientId, clientSecret);
	auth.setCredentials({ refresh_token: refreshToken });

	return google.calendar({ version: 'v3', auth });
};

export const listEvents = async (
	timeMin: string,
	timeMax: string,
): Promise<CalendarEvent[]> => {
	const calendar = await getCalendarClient();
	const calendarId = getCalendarId();
	assertRfc3339(timeMin, 'timeMin');
	assertRfc3339(timeMax, 'timeMax');

	const events: CalendarEvent[] = [];
	let pageToken: string | undefined;

	do {
		const response = await calendar.events.list({
			calendarId,
			timeMin,
			timeMax,
			singleEvents: true,
			pageToken,
		});

		for (const event of response.data.items ?? []) {
			events.push(fromGoogleEvent(event));
		}

		pageToken = response.data.nextPageToken ?? undefined;
	} while (pageToken);

	return events;
};

export const createEvent = async (
	event: CalendarEventInput,
): Promise<CalendarEvent> => {
	const calendar = await getCalendarClient();
	const calendarId = getCalendarId();
	const response = await calendar.events.insert({
		calendarId,
		requestBody: toGoogleEvent(event),
		sendUpdates: 'none',
	});

	return fromGoogleEvent(response.data);
};

export const updateEvent = async (
	eventId: string,
	patch: CalendarEventPatch,
): Promise<CalendarEvent> => {
	const calendar = await getCalendarClient();
	const calendarId = getCalendarId();
	const requestBody: calendar_v3.Schema$Event = {};

	if (patch.title !== undefined) {
		requestBody.summary = patch.title;
	}
	if (patch.start !== undefined) {
		requestBody.start = { dateTime: assertRfc3339(patch.start, 'start') };
	}
	if (patch.end !== undefined) {
		requestBody.end = { dateTime: assertRfc3339(patch.end, 'end') };
	}

	const response = await calendar.events.patch({
		calendarId,
		eventId,
		requestBody,
		sendUpdates: 'none',
	});

	return fromGoogleEvent(response.data);
};

export const deleteEvent = async (eventId: string): Promise<void> => {
	const calendar = await getCalendarClient();
	const calendarId = getCalendarId();

	try {
		await calendar.events.delete({
			calendarId,
			eventId,
			sendUpdates: 'none',
		});
	} catch (error) {
		const status = (error as { response?: { status?: number }; code?: number }).response?.status
			?? (error as { code?: number }).code;
		if (status !== 404 && status !== 410) {
			throw error;
		}
	}
};
