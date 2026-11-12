/* PWB-001 / R6 — fail-closed integrity verifier for archived Proof snapshots. */
(function (root) {
  'use strict';

  const CONTRACT = 'ROUAA_PROOF_CONTRACT_V1';
  const ALLOWED_STATES = new Set([
    'EXECUTOR_REPORTED', 'OBSERVED', 'VERIFIED', 'NOT_PROVEN', 'BLOCKED'
  ]);

  function sameItems(left, right) {
    return JSON.stringify(left.slice().sort()) === JSON.stringify(right.slice().sort());
  }

  async function sha256Hex(bytes) {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error('SHA-256 verification unavailable: Web Crypto is not available in this browser context');
    }
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function verifySnapshot(manifest, fileBytes, expectedFiles) {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Manifest is missing or invalid');
    }
    if (manifest.schema_version !== CONTRACT) {
      throw new Error('Unexpected Proof Contract version');
    }
    if (manifest.snapshot_kind !== 'ARCHIVED_SNAPSHOT') {
      throw new Error('Snapshot kind is missing or is not ARCHIVED_SNAPSHOT');
    }
    if (!manifest.data_scope || typeof manifest.data_scope !== 'string') {
      throw new Error('Manifest data_scope is missing');
    }
    if (!ALLOWED_STATES.has(manifest.verification_state)) {
      throw new Error('Manifest verification_state is missing or unrecognized');
    }
    if (!manifest.export_files || typeof manifest.export_files !== 'object') {
      throw new Error('Manifest export_files is missing');
    }
    const r7Snapshot = manifest.data_scope === 'R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT';
    if (r7Snapshot && (!manifest.core_commit || !manifest.run_id || !manifest.execution_id)) {
      throw new Error('R7 manifest is missing Core commit / run / execution identity');
    }

    const expected = expectedFiles.slice().sort();
    const declared = Object.keys(manifest.export_files).sort();
    const supplied = Array.from(fileBytes.keys()).sort();
    if (!sameItems(expected, declared)) {
      throw new Error('Manifest export list does not match the expected snapshot files');
    }
    if (!sameItems(expected, supplied)) {
      throw new Error('Snapshot is incomplete: one or more declared JSON files are missing');
    }

    const payloads = {};
    for (const filename of expected) {
      const record = manifest.export_files[filename];
      if (!record || typeof record.path !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(record.sha256 || '') ||
          !Number.isInteger(record.bytes) || record.bytes < 0) {
        throw new Error(filename + ': invalid integrity declaration in manifest');
      }
      if (record.path.split('/').pop() !== filename) {
        throw new Error(filename + ': manifest path does not match export filename');
      }

      const suppliedBytes = fileBytes.get(filename);
      const bytes = suppliedBytes instanceof Uint8Array
        ? suppliedBytes
        : new Uint8Array(suppliedBytes);
      if (bytes.byteLength !== record.bytes) {
        throw new Error(filename + ': byte-length mismatch');
      }
      const digest = await sha256Hex(bytes);
      if (digest.toLowerCase() !== record.sha256.toLowerCase()) {
        throw new Error(filename + ': SHA-256 mismatch');
      }

      let payload;
      try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) {
        throw new Error(filename + ': invalid UTF-8 or JSON (' + (error.message || String(error)) + ')');
      }
      if (payload.schema_version !== manifest.schema_version) {
        throw new Error(filename + ': Proof Contract version mismatch');
      }
      if (payload.data_scope !== manifest.data_scope) {
        throw new Error(filename + ': data_scope mismatch');
      }
      if (payload.snapshot_kind && payload.snapshot_kind !== manifest.snapshot_kind) {
        throw new Error(filename + ': snapshot_kind mismatch');
      }
      if (payload.generated_at && manifest.generated_at &&
          payload.generated_at !== manifest.generated_at) {
        throw new Error(filename + ': generated_at does not match manifest');
      }
      payloads[filename] = payload;
    }

    const artifactStateCounts = {};
    for (const artifact of (Array.isArray(manifest.source_artifacts)
      ? manifest.source_artifacts : [])) {
      const status = ALLOWED_STATES.has(artifact.state)
        ? artifact.state : 'NOT_PROVEN';
      artifactStateCounts[status] = (artifactStateCounts[status] || 0) + 1;
    }

    return {
      payloads,
      verifiedFiles: expected.length,
      totalFiles: expected.length,
      dataScope: manifest.data_scope,
      manifestState: manifest.verification_state,
      artifactStateCounts
    };
  }

  root.ROUAAProofIntegrity = Object.freeze({ verifySnapshot });
})(globalThis);
