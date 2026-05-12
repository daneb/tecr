/**
 * S-03: Multi-language repo-map — acceptance tests.
 *
 * Exit criteria:
 * - extractWasmLanguages() extracts correct symbols for Rust, Python, Go, Java.
 * - Export detection works per-language (pub / uppercase / _ prefix / public).
 * - buildRepoMap() includes symbols from all five languages in a mixed workspace.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { extractWasmLanguages } from '../ast/wasm.js';
import { buildRepoMap } from '../index.js';

// ── Fixture project ───────────────────────────────────────────────────────────

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s03-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'lib.rs'),
    `
pub fn add(a: i32, b: i32) -> i32 { a + b }
pub struct Config { pub name: String }
enum State { Active, Inactive }
pub trait Processor { fn process(&self, input: &str) -> String; }
pub type Result<T> = std::result::Result<T, String>;
`,
  );

  await writeFile(
    path.join(fixtureRoot, 'utils.py'),
    `
def compute(x, y):
    return x + y

class DataPipeline:
    def run(self):
        pass

def _internal_helper():
    pass
`,
  );

  await writeFile(
    path.join(fixtureRoot, 'main.go'),
    `
package main

func Run(port int) error { return nil }
func internalHelper() {}
type Server struct { Port int }
`,
  );

  await writeFile(
    path.join(fixtureRoot, 'Service.java'),
    `
public class Service {
    public void handle(String request) {}
    private void cleanup() {}
}
`,
  );

  // TypeScript file so buildRepoMap integration test has TS symbols too.
  await writeFile(
    path.join(fixtureRoot, 'index.ts'),
    `export function bootstrap(port: number): void {}`,
  );
}, 30_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('S-03 Rust extraction', () => {
  it('extracts pub fn as exported function', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('lib.rs'));
    expect(rec).toBeDefined();
    const add = rec!.symbols.find((s) => s.name === 'add');
    expect(add?.kind).toBe('function');
    expect(add?.exported).toBe(true);
  });

  it('extracts pub struct as class, non-pub enum as unexported', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('lib.rs'))!;
    const config = rec.symbols.find((s) => s.name === 'Config');
    expect(config?.kind).toBe('class');
    expect(config?.exported).toBe(true);
    const state = rec.symbols.find((s) => s.name === 'State');
    expect(state?.exported).toBe(false);
  });

  it('extracts pub trait as interface', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('lib.rs'))!;
    const processor = rec.symbols.find((s) => s.name === 'Processor');
    expect(processor?.kind).toBe('interface');
    expect(processor?.exported).toBe(true);
  });
});

describe('S-03 Python extraction', () => {
  it('extracts def as function, class as class', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('utils.py'))!;
    const compute = rec.symbols.find((s) => s.name === 'compute');
    expect(compute?.kind).toBe('function');
    expect(compute?.exported).toBe(true);
    const pipeline = rec.symbols.find((s) => s.name === 'DataPipeline');
    expect(pipeline?.kind).toBe('class');
    expect(pipeline?.exported).toBe(true);
  });

  it('marks underscore-prefixed names as unexported', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('utils.py'))!;
    const helper = rec.symbols.find((s) => s.name === '_internal_helper');
    expect(helper?.exported).toBe(false);
  });
});

describe('S-03 Go extraction', () => {
  it('extracts uppercase func as exported, lowercase as unexported', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('main.go'))!;
    const run = rec.symbols.find((s) => s.name === 'Run');
    expect(run?.kind).toBe('function');
    expect(run?.exported).toBe(true);
    const helper = rec.symbols.find((s) => s.name === 'internalHelper');
    expect(helper?.exported).toBe(false);
  });

  it('extracts type spec as class', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('main.go'))!;
    const server = rec.symbols.find((s) => s.name === 'Server');
    expect(server?.kind).toBe('class');
    expect(server?.exported).toBe(true);
  });
});

describe('S-03 Java extraction', () => {
  it('extracts public class as exported class', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('Service.java'))!;
    const svc = rec.symbols.find((s) => s.name === 'Service');
    expect(svc?.kind).toBe('class');
    expect(svc?.exported).toBe(true);
  });

  it('distinguishes public and private methods', async () => {
    const records = await extractWasmLanguages(fixtureRoot);
    const rec = records.find((r) => r.path.endsWith('Service.java'))!;
    const handle = rec.symbols.find((s) => s.name === 'handle');
    expect(handle?.kind).toBe('method');
    expect(handle?.exported).toBe(true);
    const cleanup = rec.symbols.find((s) => s.name === 'cleanup');
    expect(cleanup?.exported).toBe(false);
  });
});

describe('S-03 integration', () => {
  it('buildRepoMap includes symbols from all five languages', async () => {
    const result = await buildRepoMap(fixtureRoot, { budget: 4096 });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('add');         // Rust
    expect(result.text).toContain('compute');     // Python
    expect(result.text).toContain('Run');         // Go
    expect(result.text).toContain('Service');     // Java
    expect(result.text).toContain('bootstrap');   // TypeScript
  });
});
