import 'dotenv/config';
import { migrateDatabase } from './migrate.js';

await migrateDatabase();
console.log('Database migrations applied.');
