import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { OAuthProvider, Role } from "@/shared/domain";
import { mode, origin, secret } from "./config";
import { database } from "./db";
import { ApiError, guardedLimit } from "./http";

const available = ["google", "microsoft", "github"] as const;
function credentials(provider: OAuthProvider) {
  const prefix = provider.toUpperCase();
  const clientId = process.env[prefix + "_CLIENT_ID"];
  const clientSecret = process.env[prefix + "_CLIENT_SECRET"];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function signInOptions() {
  return {
    providers: available.filter((provider) => !!credentials(provider)),
    localLogin: mode() === "local",
  };
}

function buildAuth() {
  const ms = credentials("microsoft");
  const appOrigin = origin();
  return betterAuth({
    appName: "CogniCare",
    baseURL: appOrigin,
    secret: secret("AUTH_SECRET"),
    database: prismaAdapter(database(), { provider: "postgresql" }),
    trustedOrigins: [appOrigin],
    emailAndPassword: { enabled: mode() === "local", disableSignUp: true },
    socialProviders: {
      google: credentials("google"),
      github: credentials("github"),
      microsoft: ms ? { ...ms, tenantId: process.env.MICROSOFT_TENANT_ID || "common" } : undefined,
    },
    account: { accountLinking: { enabled: false }, updateAccountOnSignIn: false, encryptOAuthTokens: true },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => {
            if (account.providerId === "credential") return;
            return { data: { accessToken: null, refreshToken: null, idToken: null } };
          },
        },
      },
    },
    onAPIError: { errorURL: appOrigin + "/?account=1" },
    advanced: {
      useSecureCookies: appOrigin.startsWith("https:"),
      ipAddress: { disableIpTracking: true },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    session: { expiresIn: 12 * 60 * 60, disableSessionRefresh: true },
    rateLimit: { enabled: false },
    logger: { disabled: true },
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;
export function auth() {
  instance ??= buildAuth();
  return instance;
}

export type Actor = { userId: string; sessionId: string; role: Role; assured: boolean };

export async function actor(request: Request, requireFactor = true): Promise<Actor> {
  if (mode() === "demo") throw new ApiError(503, "accounts_disabled");
  if (!request.headers.get("cookie")) throw new ApiError(401, "sign_in");
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "sign_in");
  const row = await database().session.findFirst({
    where: { id: session.session.id, userId: session.user.id, expiresAt: { gt: new Date() } },
    select: { assuredAt: true, user: { select: { id: true, role: true } } },
  });
  if (!row) throw new ApiError(401, "sign_in");
  await guardedLimit("user:" + row.user.id, 120, 60_000);
  const assured = row.assuredAt !== null;
  if (requireFactor && !assured) throw new ApiError(403, "mfa_required");
  return { userId: row.user.id, sessionId: session.session.id, role: row.user.role, assured };
}

export function requireCareRole(actor: Actor) {
  if (actor.role === "PLAYER") throw new ApiError(403, "access_denied");
}
