import { createFileRoute } from "@tanstack/react-router";

import {
  checkRateLimit,
  getClientIp,
  json,
  loginWithDeviceId,
  playerPublic,
  preflight,
  readJson,
} from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/public/auth/login")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: async ({ request }) => {
        const ip = getClientIp(request);
        // Loose cap on login attempts per IP — mainly to slow down device-id
        // brute forcing / mass account creation from one source.
        if (!checkRateLimit(`login:${ip}`, 30, 60 * 1000)) {
          return json({ error: "Too many requests — try again shortly" }, 429);
        }

        const body = await readJson(request);
        const deviceId = typeof body["deviceId"] === "string" ? body["deviceId"].trim() : "";
        if (deviceId.length < 8 || deviceId.length > 128) {
          return json({ error: "Invalid deviceId" }, 400);
        }
        try {
          const { token, player } = await loginWithDeviceId(deviceId, ip);
          return json({ token, player: playerPublic(player) });
        } catch (err) {
          if (err instanceof Error && err.message === "ACCOUNT_BANNED") {
            return json({ error: "This account has been suspended" }, 403);
          }
          console.error("[auth/login]", err);
          return json({ error: "Login failed" }, 500);
        }
      },
    },
  },
});
