import { createDb } from '../db/client.js';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/notification_hub_test';

const { db, sql } = createDb(TEST_DB_URL);

export { db, sql };
export { TEST_DB_URL };
