# 03 - Contact Form

A serverless contact form handler with email delivery using Cloudflare Email Workers.

## Learning Objectives

- Email Workers (sending emails)
- Form data parsing
- Spam protection (honeypot, rate limiting)
- Input validation and sanitization

## Concepts

### Email Workers

Cloudflare Email Workers allow you to send, receive, and process emails:

```typescript
// Send email using MailChannels (free integration)
await fetch("https://api.mailchannels.net/tx/v1/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: "recipient@example.com" }] }],
    from: { email: "sender@yourdomain.com", name: "Contact Form" },
    subject: "New Contact Form Submission",
    content: [{ type: "text/plain", value: "Message body here" }],
  }),
});
```

### Form Data Parsing

```typescript
// Parse form data (multipart/form-data or application/x-www-form-urlencoded)
const formData = await request.formData();
const name = formData.get("name") as string;
const email = formData.get("email") as string;
const message = formData.get("message") as string;

// Parse JSON body
const { name, email, message } = await request.json();
```

### Spam Protection Techniques

1. **Honeypot Field**
   ```html
   <!-- Hidden field that bots will fill -->
   <input type="text" name="website" style="display:none" />
   ```

2. **Rate Limiting** (using KV)
   ```typescript
   const ip = request.headers.get("CF-Connecting-IP");
   const key = `rate:${ip}`;
   const count = parseInt(await env.RATE_LIMIT.get(key) || "0");

   if (count > 5) {
     return new Response("Too many requests", { status: 429 });
   }

   await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3600 });
   ```

3. **Turnstile** (Cloudflare's CAPTCHA)
   ```typescript
   const token = formData.get("cf-turnstile-response");
   const verification = await fetch(
     "https://challenges.cloudflare.com/turnstile/v0/siteverify",
     {
       method: "POST",
       headers: { "Content-Type": "application/x-www-form-urlencoded" },
       body: `secret=${env.TURNSTILE_SECRET}&response=${token}`,
     }
   );
   const { success } = await verification.json();
   ```

### Input Validation

```typescript
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeInput(input: string): string {
  return input
    .trim()
    .slice(0, 1000) // Limit length
    .replace(/[<>]/g, ""); // Remove potential HTML
}
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Contact form HTML page |
| POST | `/api/contact` | Submit contact form |
| GET | `/api/submissions` | List submissions (admin) |

## Project Tasks

### Task 1: Basic Form Handler
- Parse form data (JSON and form-urlencoded)
- Validate required fields
- Return success/error responses

### Task 2: Email Delivery
- Integrate with MailChannels
- Format email with submission details
- Handle delivery errors

### Task 3: Spam Protection
- Implement honeypot field
- Add rate limiting with KV
- Optional: Turnstile integration

### Task 4: Submission Storage
- Store submissions in KV
- Add admin endpoint to list submissions
- Add timestamp and metadata

## Commands

```bash
# Create KV namespace for rate limiting and storage
npx wrangler kv:namespace create SUBMISSIONS
npx wrangler kv:namespace create SUBMISSIONS --preview

# Add secrets
npx wrangler secret put TURNSTILE_SECRET  # Optional
npx wrangler secret put ADMIN_KEY

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
03-contact-form/
├── src/
│   ├── index.ts        # Main handler
│   ├── email.ts        # Email sending logic
│   ├── validation.ts   # Input validation
│   └── html.ts         # HTML form template
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Submit form (JSON)
curl -X POST http://localhost:8787/api/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello!"
  }'

# Submit form (form-urlencoded)
curl -X POST http://localhost:8787/api/contact \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=John&email=john@example.com&message=Hello"

# List submissions (admin)
curl http://localhost:8787/api/submissions \
  -H "X-Admin-Key: your-admin-key"
```

## MailChannels Setup

MailChannels provides free email sending for Cloudflare Workers. Setup:

1. Add a DNS TXT record for SPF:
   ```
   v=spf1 a mx include:relay.mailchannels.net ~all
   ```

2. Add DKIM record (optional but recommended)

3. Add domain lockdown TXT record:
   ```
   _mailchannels.yourdomain.com TXT "v=mc1 cfid=your-worker.workers.dev"
   ```

## Sample HTML Form

```html
<form action="/api/contact" method="POST">
  <input type="text" name="name" required placeholder="Your Name" />
  <input type="email" name="email" required placeholder="Your Email" />
  <textarea name="message" required placeholder="Your Message"></textarea>

  <!-- Honeypot -->
  <input type="text" name="website" style="display:none" tabindex="-1" />

  <!-- Turnstile (optional) -->
  <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>

  <button type="submit">Send Message</button>
</form>
```

## Key Takeaways

1. MailChannels + Workers = free transactional email
2. Always validate and sanitize user input
3. Multiple spam protection layers work better than one
4. Rate limiting prevents abuse while allowing legitimate use
5. Store submissions for backup (emails can fail)
