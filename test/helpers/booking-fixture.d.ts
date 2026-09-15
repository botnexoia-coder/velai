export const BOOKING_TEST_TENANT: string;
interface Statement {
  bind(...args: unknown[]): Statement;
  first(): Promise<Record<string, any> | null>;
  all(): Promise<{results: Record<string, any>[]}>;
  run(): Promise<unknown>;
}
export function bookingFixture(): Promise<{
  env: Record<string, any>;
  DB: {prepare(sql: string): Statement;exec(sql:string):Promise<unknown>};
  events: Map<string, any>;
  requests: {url:string;method:string}[];
  worker: {fetch(request:Request,env:unknown,ctx:unknown):Promise<Response>};
  ctx: {waitUntil(p:Promise<unknown>):void};
  origin: string;
  human(): string;
  fetchProvider: typeof fetch;
  request(path:string,body?:unknown,headers?:Record<string,string>):Promise<Response>;
  close(): Promise<void>;
}>;
