import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';

const database = createDatabase();
await migrate(database.db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await database.close();
console.log('Database migrations applied.');
