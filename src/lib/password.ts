import { scrypt, randomBytes, timingSafeEqual } from "crypto";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [salt, keyHex] = hash.split(":");
  if (!salt || !keyHex) return false;
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}
