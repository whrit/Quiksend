import { auth } from "@quiksend/auth";
import { checkAuthIpRateLimit } from "@/lib/api/v1/middleware.ts";
import { createFileRoute } from "@tanstack/react-router";

async function authRateLimited(request: Request, run: () => Promise<Response>): Promise<Response> {
  const outcome = await checkAuthIpRateLimit(request);
  if (!outcome.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "Retry-After": String(outcome.retryAfter),
        "Content-Type": "application/json",
      },
    });
  }
  return run();
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        authRateLimited(request, () => auth.handler(request)),
      POST: ({ request }: { request: Request }) =>
        authRateLimited(request, () => auth.handler(request)),
    },
  },
});
