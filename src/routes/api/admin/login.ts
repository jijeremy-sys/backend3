import { createFileRoute } from "@tanstack/react-router";

import {
  ADMIN_SESSION_COOKIE,
  checkAdminCredentials,
  checkAdminLoginRateLimit,
  getClientIp,
  json,
  logSecurityEvent,
  preflight,
  readJson,
  signAdminToken,
} from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: async ({ request }) => {
        const ip = getClientIp(request);

        if (!checkAdminLoginRateLimit(ip)) {
          void logSecurityEvent("admin_login_rate_limited", { ip });
          return json({ error: "Too many attempts — try again later" }, 429);
        }

        const body = await readJson(request);
        const username = typeof body["username"] === "string" ? body["username"].trim() : "";
        const password = typeof body["password"] === "string" ? body["password"] : "";

        if (!(await checkAdminCredentials(username, password))) {
          void logSecurityEvent("admin_login_fail", { ip, detail: { username } });
          return json({ error: "Invalid username or password" }, 401);
        }

        void logSecurityEvent("admin_login_success", { ip });

        const token = await signAdminToken();
        const maxAge = 7 * 24 * 60 * 60;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(
              token,
            )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
          },
        });
      },
    },
  },
});
