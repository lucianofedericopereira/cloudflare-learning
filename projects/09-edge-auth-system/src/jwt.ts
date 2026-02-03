/**
 * JWT utilities using Web Crypto API
 */

interface JWTPayload {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

function base64url(data: string | ArrayBuffer): string {
  let base64: string;

  if (typeof data === "string") {
    base64 = btoa(data);
  } else {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function createAccessToken(
  payload: { userId: string; role: string },
  secret: string,
  expiresIn: number
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const claims: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signatureInput)
  );

  return `${signatureInput}.${base64url(signature)}`;
}

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signature = base64urlDecode(encodedSignature);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      new TextEncoder().encode(signatureInput)
    );

    if (!valid) return null;

    // Decode payload
    const payloadJson = atob(
      encodedPayload.replace(/-/g, "+").replace(/_/g, "/")
    );
    const claims = JSON.parse(payloadJson) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      return null;
    }

    return claims;
  } catch (error) {
    console.error("JWT verification error:", error);
    return null;
  }
}

export async function createRefreshToken(
  payload: { userId: string },
  secret: string,
  expiresIn: number
): Promise<string> {
  return createAccessToken({ ...payload, role: "" }, secret, expiresIn);
}

export async function verifyRefreshToken(
  token: string,
  secret: string
): Promise<{ userId: string } | null> {
  const claims = await verifyAccessToken(token, secret);
  if (!claims) return null;
  return { userId: claims.userId };
}
