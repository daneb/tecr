#!/usr/bin/env tsx
/**
 * pnpm measure — run the golden corpus through the TECR-L3 harness and write
 * results.json with all §9.1 metrics.
 *
 * Usage:
 *   pnpm measure                  # writes results.json at repo root
 *   pnpm measure --out custom.json
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { loadCorpus } from '@tecr/core';
import { runCorpusEntry } from '../packages/tecr-core/src/harness/runner.js';

const outArg = process.argv.indexOf('--out');
const outPath = outArg !== -1 ? process.argv[outArg + 1] : path.resolve(process.cwd(), 'results.json');

async function main() {
  const corpus = loadCorpus();
  console.log(`Running harness against ${corpus.length} corpus entries…\n`);

  const results = [];
  for (const entry of corpus) {
    process.stdout.write(`  ${entry.id} (${entry.language})… `);
    const { metrics } = await runCorpusEntry(entry);
    console.log('done');
    results.push({ id: entry.id, language: entry.language, prompt: entry.prompt, metrics });
  }

  const output = {
    timestamp: new Date().toISOString(),
    windowSize: 200_000,
    entries: results,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);

  // Print summary table.
  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('id        discoveryCost  utilPeak  truncRate  repoMapHit  roI');
  console.log('─────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const m = r.metrics;
    console.log(
      `${r.id.padEnd(9)} ${String(m.discoveryCost).padEnd(14)} ${m.utilizationPeak.toFixed(4).padEnd(9)} ` +
      `${m.truncationRate.toFixed(2).padEnd(10)} ${m.repoMapHitRate.toFixed(2).padEnd(11)} ${m.subAgentRoi.toFixed(2)}`,
    );
  }
  console.log('─────────────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
