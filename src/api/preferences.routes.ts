import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { userPreferences } from '../db/schema.js';
import { upsertPreferencesSchema } from './schemas.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface PreferencesRoutesOptions {
  db: Database;
}

export const preferencesRoutes = fp<PreferencesRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // PUT /api/preferences/:userId — create or update
  app.put<{ Params: { userId: string } }>('/api/preferences/:userId', async (request) => {
    const parsed = upsertPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid preferences data', parsed.error.issues.map((i) => i.message));
    }

    const userId = request.params.userId;
    const data = parsed.data;

    const values: typeof userPreferences.$inferInsert = {
      tenantId: request.tenantId,
      userId,
      email: data.email,
      phone: data.phone,
      optOut: data.opt_out,
      quietHours: data.quiet_hours,
      digestMode: data.digest_mode,
      digestSchedule: data.digest_schedule,
    };

    const updates: Partial<typeof userPreferences.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.opt_out !== undefined) updates.optOut = data.opt_out;
    if (data.quiet_hours !== undefined) updates.quietHours = data.quiet_hours;
    if (data.digest_mode !== undefined) updates.digestMode = data.digest_mode;
    if (data.digest_schedule !== undefined) updates.digestSchedule = data.digest_schedule;

    const [prefs] = await db
      .insert(userPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: [userPreferences.tenantId, userPreferences.userId],
        set: updates,
      })
      .returning();

    return { preferences: prefs };
  });

  // GET /api/preferences/:userId
  app.get<{ Params: { userId: string } }>('/api/preferences/:userId', async (request) => {
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.tenantId, request.tenantId),
          eq(userPreferences.userId, request.params.userId),
        ),
      );

    if (!prefs) {
      throw new NotFoundError(`Preferences for user ${request.params.userId} not found`);
    }

    return { preferences: prefs };
  });
});
