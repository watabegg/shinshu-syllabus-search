import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Run only after the data import/correction has completed successfully.
const config = new URL('../wrangler.jsonc', import.meta.url);
const source = readFileSync(config, 'utf8');
const version = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}`;
if (!/"DATA_VERSION"\s*:\s*"[^"]+"/.test(source)) throw new Error('DATA_VERSION is missing');
writeFileSync(config, source.replace(/"DATA_VERSION"\s*:\s*"[^"]+"/, `"DATA_VERSION": "${version}"`));
console.log(`DATA_VERSION: ${version}. Regenerate types, build and deploy to activate.`);
