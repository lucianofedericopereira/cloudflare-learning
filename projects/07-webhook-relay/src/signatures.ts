/**
 * Webhook signature handling
 */

// Verify incoming webhook signature
export async function verifySignature(
  payload: string,
  signature: string,
  secret: string,
  source: string
): Promise<boolean> {
  try {
    // Different sources have different signature formats
    switch (source) {
      case "stripe":
        return verifyStripeSignature(payload, signature, secret);
      case "github":
        return verifyGitHubSignature(payload, signature, secret);
      default:
        return verifyHmacSignature(payload, signature, secret);
    }
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

// Stripe signature format: t=timestamp,v1=signature
async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signature = parts.find((p) => p.startsWith("v1="))?.slice(3);

  if (!timestamp || !signature) {
    return false;
  }

  // Stripe signs: timestamp.payload
  const signedPayload = `${timestamp}.${payload}`;
  return verifyHmacSignature(signedPayload, signature, secret);
}

// GitHub signature format: sha256=signature
async function verifyGitHubSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const signature = signatureHeader.replace("sha256=", "");
  return verifyHmacSignature(payload, signature, secret);
}

// Generic HMAC-SHA256 verification
async function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureBytes = hexToBytes(signature);
  const payloadBytes = encoder.encode(payload);

  return crypto.subtle.verify("HMAC", key, signatureBytes, payloadBytes);
}

// Create signature for outgoing webhooks
export async function createSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return bytesToHex(new Uint8Array(signature));
}

// Create Stripe-style signature with timestamp
export async function createTimestampedSignature(
  payload: string,
  secret: string
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = await createSignature(signedPayload, secret);
  return `t=${timestamp},v1=${signature}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
