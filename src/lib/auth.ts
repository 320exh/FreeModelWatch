import { scrypt, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";

function getPasswordHash(): string {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    throw new Error("ADMIN_PASSWORD_HASH environment variable is not set");
  }
  return hash;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, derivedKey] = hash.split(":");
  if (!salt || !derivedKey) return false;
  const derivedKeyBuf = Buffer.from(derivedKey, "hex");
  const testKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(testKey, derivedKeyBuf);
}

export function extractBasicAuth(authHeader: string | null): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) return null;
  return {
    username: decoded.slice(0, colonIndex),
    password: decoded.slice(colonIndex + 1),
  };
}

export async function verifyBasicAuth(authHeader: string | null): Promise<string | null> {
  const credentials = extractBasicAuth(authHeader);
  if (!credentials) return null;
  if (credentials.username !== ADMIN_USERNAME) return null;
  const hash = getPasswordHash();
  const valid = await verifyPassword(credentials.password, hash);
  return valid ? credentials.username : null;
}

export function requireAuthHeader(authHeader: string | null): string {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    throw new Error("UNAUTHORIZED");
  }
  return authHeader;
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Basic realm="FreeAI.today Admin"',
    },
  });
}