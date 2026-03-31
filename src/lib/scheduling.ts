export function computeScheduledFor(
  schedule: 'hourly' | 'daily' | 'weekly',
  now: Date = new Date(),
): Date {
  const result = new Date(now);

  switch (schedule) {
    case 'hourly':
      result.setUTCMinutes(0, 0, 0);
      result.setUTCHours(result.getUTCHours() + 1);
      return result;

    case 'daily': {
      result.setUTCMinutes(0, 0, 0);
      result.setUTCHours(9);
      if (result.getTime() <= now.getTime()) {
        result.setUTCDate(result.getUTCDate() + 1);
      }
      return result;
    }

    case 'weekly': {
      const dayOfWeek = result.getUTCDay(); // 0=Sun, 1=Mon
      const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
      result.setUTCDate(result.getUTCDate() + daysUntilMonday);
      result.setUTCHours(9, 0, 0, 0);
      if (result.getTime() <= now.getTime()) {
        result.setUTCDate(result.getUTCDate() + 7);
      }
      return result;
    }
  }
}
