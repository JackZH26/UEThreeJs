/**
 * 把 JSON Schema 写到 docs/generated/ —— 供外部 AI agent 读取。
 * 用法：pnpm schema:emit
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from '../document.js';
import { toJsonSchemaFragments } from '../jsonSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../../docs/generated');

mkdirSync(outDir, { recursive: true });

const fragments = toJsonSchemaFragments();
for (const [name, schema] of Object.entries(fragments)) {
  const file = resolve(outDir, `roomgraph.${name}.schema.json`);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`  ✓ ${name.padEnd(12)} → docs/generated/roomgraph.${name}.schema.json`);
}

console.log(`\nJSON Schema 已生成（schemaVersion ${SCHEMA_VERSION}）`);
