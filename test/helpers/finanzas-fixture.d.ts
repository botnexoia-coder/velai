interface Row { [key: string]: string | number | null }
interface Statement {
  bind(...args: unknown[]): Statement;
  first(): Promise<Row | null>;
  all(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}
export function finanzasFixture(): Promise<{
  DB: { prepare(sql: string): Statement; exec(sql: string): Promise<unknown> };
  scope: { role: string; tenantId: string | null; email: string };
  request(request: Request): Promise<Response>;
  close(): Promise<void>;
}>;
