interface Row { [key: string]: string | number | null }
interface Statement {
  bind(...args: unknown[]): Statement;
  first(): Promise<Row | null>;
  all(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}
export const MEDIA_TENANT: string;
export const MEDIA_OTHER: string;
export function mediaBytes(signature?: string, size?: number): Uint8Array;
export function bibliotecaFixture(): Promise<{
  DB: { prepare(sql: string): Statement; exec(sql: string): Promise<unknown> };
  scope: { role: string; tenantId: string | null; email: string };
  request(request: Request): Promise<Response>;
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  close(): Promise<void>;
}>;
