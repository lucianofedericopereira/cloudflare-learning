/**
 * Password hashing using PBKDF2
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // Import password as key
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    KEY_LENGTH * 8
  );

  // Encode as hex
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    if (parts[0] !== "pbkdf2" || parts.length !== 4) {
      return false;
    }

    const iterations = parseInt(parts[1]);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    // Decode salt from hex
    const salt = new Uint8Array(saltHex.length / 2);
    for (let i = 0; i < saltHex.length; i += 2) {
      salt[i / 2] = parseInt(saltHex.slice(i, i + 2), 16);
    }

    // Import password as key
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    // Derive key using same parameters
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      passwordKey,
      KEY_LENGTH * 8
    );

    // Compare hashes
    const actualHashHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (actualHashHex.length !== expectedHashHex.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < actualHashHex.length; i++) {
      result |= actualHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
    }

    return result === 0;
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
}
