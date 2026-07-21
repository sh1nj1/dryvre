import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';

export async function migrateDatabase(databaseUrl = process.env.DATABASE_URL) {
  const database = createDatabase(databaseUrl);
  try {
    await migrate(database.db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  } finally {
    await database.close();
  }
}
