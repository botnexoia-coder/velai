interface Row { [key: string]: string | number | null }
interface Statement {
  bind(...args: unknown[]): Statement;
  first(): Promise<Row | null>;
  all(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}
export const PLANTILLAS_TENANT: string;
export function plantillasFixture(opts?: { email?: string }): Promise<{
  DB: { prepare(sql: string): Statement; exec(sql: string): Promise<unknown> };
  twilio: { content: { types: Record<string, { body: string }> }[]; approvals: { name: string }[] };
  twilioFetch: typeof fetch;
  request(request: Request): Promise<Response>;
  close(): Promise<void>;
}>;
