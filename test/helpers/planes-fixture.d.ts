interface Row { [key: string]: string | number | null }
interface Statement {
  bind(...args: unknown[]): Statement;
  first(): Promise<Row | null>;
  all(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}
export const PLAN_TENANT: string;
export function planesFixture(): Promise<{
  DB: { prepare(sql: string): Statement; exec(sql: string): Promise<unknown> };
  scope: { role: string; tenantId: string | null; email: string };
  setupWhatsApp(): Promise<{
    address: string;
    senderSid: string;
    requests: { path: string; method: string; body: { webhook?: { callback_url: string } } | null }[];
    fetchProvider: typeof fetch;
  }>;
  request(request: Request): Promise<Response>;
  close(): Promise<void>;
}>;
