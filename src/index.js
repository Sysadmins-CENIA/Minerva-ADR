import { handler as resolve } from './resolvers';
import { ensureMigrations } from './database/migrations';

// Aplica las migraciones pendientes antes de atender, así cubren instalaciones nuevas y deploys menores sin trigger.
export const handler = async (...args) => {
  await ensureMigrations();
  return resolve(...args);
};
