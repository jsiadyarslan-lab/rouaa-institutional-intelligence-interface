'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'proof-workbench-integrity.js'), 'utf8');
const sandbox = { crypto: webcrypto, TextDecoder, Uint8Array };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const verifySnapshot = sandbox.ROUAAProofIntegrity.verifySnapshot;

async function fixture(payloadOverrides = {}) {
  const payload = {
    schema_version: 'ROUAA_PROOF_CONTRACT_V1',
    data_scope: 'R4_ISOLATED_BENCHMARK',
    ...payloadOverrides
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = Array.from(new Uint8Array(
    await webcrypto.subtle.digest('SHA-256', bytes)
  )).map(v => v.toString(16).padStart(2, '0')).join('');
  const filename = 'proof-summary.json';
  const manifest = {
    schema_version: 'ROUAA_PROOF_CONTRACT_V1',
    snapshot_kind: 'ARCHIVED_SNAPSHOT',
    data_scope: 'R4_ISOLATED_BENCHMARK',
    verification_state: 'EXECUTOR_REPORTED',
    source_artifacts: [{ path: 'docs/source.json', state: 'OBSERVED' }],
    export_files: {
      [filename]: {
        path: 'proof-export/p28r5/' + filename,
        sha256: digest,
        bytes: bytes.byteLength
      }
    }
  };
  return { manifest, filename, bytes, digest };
}

test('accepts a complete snapshot whose digest, contract and scope match', async () => {
  const f = await fixture();
  const result = await verifySnapshot(
    f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]);
  assert.equal(result.verifiedFiles, 1);
  assert.equal(result.manifestState, 'EXECUTOR_REPORTED');
  assert.equal(result.artifactStateCounts.OBSERVED, 1);
});

test('rejects a missing export file', async () => {
  const f = await fixture();
  await assert.rejects(
    verifySnapshot(f.manifest, new Map(), [f.filename]),
    /incomplete|missing/i);
});

test('rejects a modified export even when the JSON remains parseable', async () => {
  const f = await fixture();
  const changed = new Uint8Array(f.bytes);
  changed[changed.length - 2] = changed[changed.length - 2] ^ 1;
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, changed]]), [f.filename]),
    /SHA-256 mismatch/);
});

test('rejects a cross-scope export', async () => {
  const f = await fixture({ data_scope: 'PRODUCTION_BASELINE' });
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]),
    /data_scope mismatch/);
});

test('rejects a contract-version mismatch', async () => {
  const f = await fixture({ schema_version: 'ROUAA_PROOF_CONTRACT_V0' });
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]),
    /Proof Contract version mismatch/);
});

test('rejects manifests that omit or add export declarations', async () => {
  const f = await fixture();
  f.manifest.export_files['proof-facts.json'] = {
    path: 'proof-export/p28r5/proof-facts.json',
    sha256: f.digest,
    bytes: f.bytes.byteLength
  };
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]),
    /expected snapshot files/);
});

async function fixtureR7(payloadOverrides = {}) {
  const identity = {
    snapshot_kind: 'ARCHIVED_SNAPSHOT',
    generated_at: '2026-11-12T22:00:00Z',
    core_commit: 'core-commit-r7',
    run_id: 'run-p28r7',
    execution_id: 'exec-p28r7-001'
  };
  const payload = {
    schema_version: 'ROUAA_PROOF_CONTRACT_V1',
    data_scope: 'R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT',
    ...identity,
    ...payloadOverrides
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = Array.from(new Uint8Array(
    await webcrypto.subtle.digest('SHA-256', bytes)
  )).map(v => v.toString(16).padStart(2, '0')).join('');
  const filename = 'proof-summary.json';
  const manifest = {
    schema_version: 'ROUAA_PROOF_CONTRACT_V1',
    data_scope: 'R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT',
    verification_state: 'OBSERVED',
    export_files: {
      [filename]: {
        path: 'proof-export/p28r7/' + filename,
        sha256: digest,
        bytes: bytes.byteLength
      }
    },
    ...identity
  };
  return { manifest, filename, bytes, payload };
}

test('accepts R7 only when Core commit, run and execution identity are bound', async () => {
  const f = await fixtureR7();
  const result = await verifySnapshot(
    f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]);
  assert.equal(result.coreCommit, 'core-commit-r7');
  assert.equal(result.runId, 'run-p28r7');
  assert.equal(result.executionId, 'exec-p28r7-001');
  assert.equal(result.snapshotKind, 'ARCHIVED_SNAPSHOT');
  assert.equal(result.manifestState, 'OBSERVED');
});

test('rejects an R7 export whose run identity differs from its manifest', async () => {
  const f = await fixtureR7({ run_id: 'different-run' });
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]),
    /run_id does not match manifest/);
});

test('rejects an R7 manifest missing execution identity', async () => {
  const f = await fixtureR7();
  delete f.manifest.execution_id;
  await assert.rejects(
    verifySnapshot(f.manifest, new Map([[f.filename, f.bytes]]), [f.filename]),
    /missing Core commit \/ run \/ execution identity/);
});
