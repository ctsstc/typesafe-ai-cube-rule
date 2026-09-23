export interface Env {
  TYPESAFE_API_KEY?: string;
  CLASSIFICATIONS?: KVNamespace;
  DB?: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  SESSION_SECRET?: string;
  DAILY_CALL_LIMIT?: string;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
