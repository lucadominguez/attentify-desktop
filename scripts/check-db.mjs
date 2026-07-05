#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

const dataDir = 'C:\\ProgramData\\Attentify';
const dbPath = path.join(dataDir, 'daemon.db');

console.log('=== Files in data dir ===');
for (const f of fs.readdirSync(dataDir)) {
  const stat = fs.statSync(path.join(dataDir, f));
  console.log(`  ${f}  ${(stat.size/1024).toFixed(1)}KB  ${stat.mtime.toISOString()}`);
}

console.log(`\n=== DB: ${dbPath} ===`);
const SQL = await initSqlJs();
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

// Check if stale entries still exist
const stale = db.exec("SELECT id, value, status, confidence, created_at FROM inferences WHERE value IN ('instagram.com', 'youtube.com')");
console.log('\nStale entries in DB:');
if (stale[0]?.values) {
  stale[0].values.forEach(row => console.log(`  id=${row[0]} value=${row[1]} status=${row[2]} conf=${row[3]}`));
} else {
  console.log('  NONE — deleted successfully');
}

// Show total inference count
const count = db.exec("SELECT COUNT(*) as c FROM inferences");
console.log(`\nTotal inferences: ${count[0]?.values[0]?.[0] ?? '?'}`);

// Show all inferences
const all = db.exec("SELECT value, status, confidence FROM inferences ORDER BY created_at DESC LIMIT 20");
console.log('\nAll inferences (last 20):');
if (all[0]?.values) {
  all[0].values.forEach(row => console.log(`  ${row[0].padEnd(25)} ${row[1].padEnd(14)} ${row[2]}`));
}

db.close();
