import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tables = ['papers', 'jobs', 'connections', 'settings', 'followups', 'repoTraces', 'methodTables', 'methodDrafts', 'deliveries', 'highlights'];

export async function openLibrary(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = join(directory, 'papers');
  await mkdir(files, { recursive: true });
  const db = new DatabaseSync(join(directory, 'library.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;');
  for (const table of tables) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  const query = Object.fromEntries(tables.map(table => [table, {
    one: db.prepare(`SELECT data FROM ${table} WHERE id = ?`),
    list: db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`),
    put: db.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`),
    del: db.prepare(`DELETE FROM ${table} WHERE id = ?`),
  }]));
  return {
    directory, files,
    get: (table, id) => parse(query[table].one.get(id)),
    all: table => query[table].list.all().map(parse),
    put(table, value) { query[table].put.run(value.id, JSON.stringify(value)); return value; },
    remove: (table, id) => query[table].del.run(id),
    path: (paperId, name) => join(files, paperId, name),
    async snapshot() {
      const filename = join(directory, `backup-${randomUUID()}.sqlite`);
      try {
        db.prepare('VACUUM INTO ?').run(filename);
        return await readFile(filename);
      } finally { await rm(filename, { force: true }); }
    },
    close: () => db.close(),
  };
}

function parse(row) {
  return row && JSON.parse(row.data);
}

export async function writeAtomic(path, contents) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
