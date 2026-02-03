/**
 * 03 - Contact Form
 *
 * A serverless contact form handler with:
 * - Email delivery via MailChannels
 * - Spam protection (honeypot, rate limiting)
 * - Form validation
 * - Submission storage
 */

import { getContactFormHtml } from "./html";
import { sendEmail } from "./email";
import { validateContactForm, sanitizeInput } from "./validation";

export interface Env {
  SUBMISSIONS: KVNamespace;
  RECIPIENT_EMAIL: string;
  SENDER_EMAIL: string;
  ADMIN_KEY: string;
  TURNSTILE_SECRET?: string;
}

interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  timestamp: string;
  ip: string;
  userAgent: string;
  emailSent: boolean;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
};

// ============================================
// Rate Limiting
// ============================================

async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rate:${ip}`;
  const count = parseInt((await env.SUBMISSIONS.get(key)) || "0");

  if (count >= 5) {
    return false; // Rate limited
  }

  await env.SUBMISSIONS.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

// ============================================
// Turnstile Verification
// ============================================

async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string
): Promise<boolean> {
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: ip,
        }),
      }
    );

    const result = (await response.json()) as { success: boolean };
    return result.success;
  } catch {
    return false;
  }
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // GET / - Contact Form HTML
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return new Response(getContactFormHtml(), {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      // ============================================
      // POST /api/contact - Submit Form
      // ============================================

      if (pathname === "/api/contact" && request.method === "POST") {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const userAgent = request.headers.get("User-Agent") || "unknown";

        // Rate limiting
        const allowed = await checkRateLimit(env, ip);
        if (!allowed) {
          return Response.json(
            { error: "Too many requests. Please try again later." },
            { status: 429, headers: corsHeaders }
          );
        }

        // Parse form data
        const contentType = request.headers.get("Content-Type") || "";
        let name: string, email: string, message: string, honeypot: string, turnstileToken: string;

        if (contentType.includes("application/json")) {
          const body = await request.json() as Record<string, string>;
          name = body.name || "";
          email = body.email || "";
          message = body.message || "";
          honeypot = body.website || "";
          turnstileToken = body["cf-turnstile-response"] || "";
        } else {
          const formData = await request.formData();
          name = (formData.get("name") as string) || "";
          email = (formData.get("email") as string) || "";
          message = (formData.get("message") as string) || "";
          honeypot = (formData.get("website") as string) || "";
          turnstileToken = (formData.get("cf-turnstile-response") as string) || "";
        }

        // Honeypot check
        if (honeypot) {
          // Bot detected - silently accept but don't process
          return Response.json(
            { success: true, message: "Thank you for your message!" },
            { headers: corsHeaders }
          );
        }

        // Turnstile verification (if configured)
        if (env.TURNSTILE_SECRET && turnstileToken) {
          const verified = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
          if (!verified) {
            return Response.json(
              { error: "CAPTCHA verification failed. Please try again." },
              { status: 400, headers: corsHeaders }
            );
          }
        }

        // Sanitize inputs
        name = sanitizeInput(name);
        email = sanitizeInput(email);
        message = sanitizeInput(message, 5000);

        // Validate
        const validation = validateContactForm({ name, email, message });
        if (!validation.valid) {
          return Response.json(
            { error: "Validation failed", errors: validation.errors },
            { status: 400, headers: corsHeaders }
          );
        }

        // Create submission record
        const submission: ContactSubmission = {
          id: crypto.randomUUID(),
          name,
          email,
          message,
          timestamp: new Date().toISOString(),
          ip,
          userAgent,
          emailSent: false,
        };

        // Send email
        let emailSent = false;
        try {
          await sendEmail({
            to: env.RECIPIENT_EMAIL,
            from: env.SENDER_EMAIL,
            replyTo: email,
            subject: `Contact Form: ${name}`,
            name,
            email,
            message,
          });
          emailSent = true;
          submission.emailSent = true;
        } catch (error) {
          console.error("Email sending failed:", error);
          // Continue - we'll store the submission anyway
        }

        // Store submission
        await env.SUBMISSIONS.put(
          `submission:${submission.id}`,
          JSON.stringify(submission),
          { expirationTtl: 60 * 60 * 24 * 30 } // 30 days
        );

        return Response.json(
          {
            success: true,
            message: "Thank you for your message! We'll get back to you soon.",
            emailSent,
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // GET /api/submissions - List Submissions (Admin)
      // ============================================

      if (pathname === "/api/submissions" && request.method === "GET") {
        const adminKey = request.headers.get("X-Admin-Key");

        if (adminKey !== env.ADMIN_KEY) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const submissions: ContactSubmission[] = [];
        let cursor: string | undefined;

        do {
          const result = await env.SUBMISSIONS.list({
            prefix: "submission:",
            cursor,
            limit: 100,
          });

          for (const key of result.keys) {
            const data = await env.SUBMISSIONS.get(key.name);
            if (data) {
              submissions.push(JSON.parse(data));
            }
          }

          cursor = result.list_complete ? undefined : result.cursor;
        } while (cursor);

        // Sort by timestamp descending
        submissions.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        return Response.json(
          { submissions, total: submissions.length },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // API Documentation
      // ============================================

      if (pathname === "/api" && request.method === "GET") {
        return Response.json(
          {
            name: "Contact Form API",
            version: "1.0.0",
            endpoints: {
              "GET /": "Contact form HTML page",
              "POST /api/contact": {
                description: "Submit contact form",
                body: {
                  name: "string (required)",
                  email: "string (required)",
                  message: "string (required)",
                  "cf-turnstile-response": "string (optional)",
                },
              },
              "GET /api/submissions": {
                description: "List all submissions (admin only)",
                headers: { "X-Admin-Key": "required" },
              },
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
