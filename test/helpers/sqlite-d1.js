// Real SQLite via the Python stdlib: runs on Node 20 CI without native npm addons.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';
const python = `import sys,json,sqlite3
conn=sqlite3.connect(':memory:')
conn.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  req=json.loads(line)
  if 'script' in req:
   conn.executescript(req['script']); out=None
  else:
   out=[]
   with conn:
    for s in req['statements']:
     cur=conn.execute(s['sql'],s.get('args',[]))
     rows=[dict(r) for r in cur.fetchall()] if cur.description else []
     out.append({'results':rows,'meta':{'changes':max(cur.rowcount,0)}})
  print(json.dumps({'ok':out}),flush=True)
 except Exception as e:
  print(json.dumps({'error':str(e)}),flush=True)
`;
export async function sqliteD1() {
  const child = spawn('python3', ['-u', '-c', python], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = [];
  createInterface({ input: child.stdout }).on('line', (line) => { const cb = pending.shift(); const data = JSON.parse(line); data.error ? cb.reject(new Error(data.error)) : cb.resolve(data.ok); });
  child.on('error', (err) => { while (pending.length) pending.shift().reject(err); });
  const call = (request) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify(request) + '\n'); });
  const statement = (sql, args = []) => ({ sql, args, bind: (...values) => statement(sql, values),
    async run() { return (await call({ statements: [{ sql, args }] }))[0]; },
    async all() { return this.run(); }, async first() { return (await this.run()).results[0] || null; },
  });
  const db = { prepare: statement, batch: (statements) => call({ statements }), exec: (script) => call({ script }), close: () => child.stdin.end() };
  const root = new URL('../../migrations/', import.meta.url);
  for (const name of (await readdir(root)).filter((s) => s.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, root), 'utf8'));
  return db;
}
