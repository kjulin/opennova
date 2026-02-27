import crypto from "crypto";

interface PairingCode {
  code: string;
  expiresAt: number;
}

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const CODE_LENGTH = 6;

let activeCode: PairingCode | null = null;

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function generatePairingCode(): { code: string; expiresAt: number } {
  const code = generateCode();
  const expiresAt = Date.now() + EXPIRY_MS;
  activeCode = { code, expiresAt };
  return { code, expiresAt };
}

export function validatePairingCode(code: string): boolean {
  if (!activeCode) return false;
  if (Date.now() > activeCode.expiresAt) {
    activeCode = null;
    return false;
  }
  if (activeCode.code !== code) return false;

  // Consume the code (single-use)
  activeCode = null;
  return true;
}
