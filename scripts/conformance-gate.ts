#!/usr/bin/env tsx
/**
 * pnpm gate — TECR-L4 conformance gate.
 *
 * Runs the golden corpus through the measurement harness and asserts the
 * §9.3 acceptance thresholds. Exits 0 if all gates pass, 1 if any fail.
 *
 * Usage:
 *   pnpm gate                    # run against all corpus entries
 *   TECR_NO_TELEMETRY=1 pnpm gate  # suppress per-turn telemetry noise
 */

import {
  loadCorpus,
  runCorpusEntry,
  checkGates,
  DISCOVERY_COST_LIMIT,
  UTILIZATION_PEAK_LIMIT,
  TRUNCATION_RATE_LIMIT,
} from '@tecr/core';

const PASS = '✓';
const FAIL = '✗';

async function main() {
  const corpus = loadCorpus();

  console.log('TECR-L4 Conformance Gate');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Thresholds: discoveryCost ≤ ${DISCOVERY_COST_LIMIT} | utilizationPeak ≤ ${UTILIZATION_PEAK_LIMIT} | truncationRate < ${TRUNCATION_RATE_LIMIT}`);
  console.log('════════════════════════════════════════════════════════════════\n');

  let totalFailed = 0;

  for (const entry of corpus) {
    process.stdout.write(`Running [${entry.id}] (${entry.language})… `);
    const { metrics } = await runCorpusEntry(entry);
    console.log('done\n');

    const results = checkGates(entry.id, metrics);
    for (const r of results) {
      const icon = r.pass ? PASS : FAIL;
      const label = `${r.metric.padEnd(18)} ${String(r.value.toFixed ? r.value.toFixed(5) : r.value).padEnd(12)} ${r.operator} ${r.limit}`;
      console.log(`  ${icon}  [${r.corpusId}] ${label}`);
      if (!r.pass) totalFailed++;
    }
    console.log();
  }

  console.log('════════════════════════════════════════════════════════════════');
  if (totalFailed === 0) {
    console.log(`All gates passed. TECR-L4 ${PASS}`);
    process.exit(0);
  } else {
    console.error(`${totalFailed} gate(s) failed. TECR-L4 ${FAIL}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
