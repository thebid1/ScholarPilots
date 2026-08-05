import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { readFileSync } from 'fs';
import { join } from 'path';
import { queryDb } from '../lib/db';

async function runSchema() {
  const schema = readFileSync(join(process.cwd(), 'schema.sql'), 'utf-8');
  await queryDb(schema);
  console.log('Schema applied successfully!');
}

runSchema().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
