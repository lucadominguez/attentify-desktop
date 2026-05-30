#!/usr/bin/env node
/**
 * Clear stale inference entries for Instagram and YouTube from SQLite DB.
 */
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

const BASE = 'http://127.0.0.1:9119';

async function GET(p) {
  const r = await fetch(`${BASE}${p}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  // 1. Get log path to find data dir
  const logs = await GET('/logs?n=1');
  const logPath = (logs.body.path || '');
  console.log(`Log path: ${logPath}`);

  if (!logPath) {
    console.log('Could not determine data dir from log path');
    return;
  }

  const dataDir = path.dirname(path.dirname(logPath));
  const dbPath = path.join(dataDir, 'daemon.db');
  console.log(`DB path: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`DB not found`);
    return;
  }

  // 2. Open DB and clear stale entries
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  // Show stale inferences
  const stale = db.exec(
    "SELECT id, value, status, confidence, created_at FROM inferences WHERE value IN ('instagram.com', 'youtube.com')"
  );
  console.log('\nStale inferences:');
  if (stale[0]?.values) {
    stale[0].values.forEach(row => console.log(`  id=${row[0]} value=${row[1]} status=${row[2]} conf=${row[3]} created=${row[4]}`));
    const count = stale[0].values.length;
    db.run("DELETE FROM inferences WHERE value IN ('instagram.com', 'youtube.com')");
    console.log(`\nDeleted ${count} stale entries`);
  } else {
    console.log('  (none found)');
  }

  // Also clear processed cache entries for these domains
  db.run("DELETE FROM processed_cache WHERE key LIKE '%instagram.com%' OR key LIKE '%youtube.com%'");

  // Save
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();
  console.log('DB saved. Stale data cleared.');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
