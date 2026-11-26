import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" + (dev ? " 'unsafe-eval'" : ""),
    "style-src 'self'" + (dev ? " 'unsafe-inline'" : " 'nonce-" + nonce + "'"),
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'" + (dev ? " ws: wss:" : ""),
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  if (process.env.COGNICARE_MODE === "service") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}

export const config = { matcher: ["/"] };
