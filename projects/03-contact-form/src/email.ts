/**
 * Email sending functionality using MailChannels
 */

interface EmailOptions {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  name: string;
  email: string;
  message: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const { to, from, replyTo, subject, name, email, message } = options;

  // Format email body
  const textBody = `
New contact form submission:

Name: ${name}
Email: ${email}

Message:
${message}

---
Sent via Contact Form Worker
  `.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f97316; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .field { margin-bottom: 16px; }
    .label { font-weight: 600; color: #374151; }
    .value { color: #1f2937; margin-top: 4px; }
    .message { background: white; padding: 16px; border-radius: 4px; border: 1px solid #e5e7eb; white-space: pre-wrap; }
    .footer { padding: 16px; text-align: center; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">New Contact Form Submission</h2>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Name</div>
        <div class="value">${escapeHtml(name)}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div>
      </div>
      <div class="field">
        <div class="label">Message</div>
        <div class="message">${escapeHtml(message)}</div>
      </div>
    </div>
    <div class="footer">
      Sent via Contact Form Worker
    </div>
  </div>
</body>
</html>
  `.trim();

  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
        },
      ],
      from: {
        email: from,
        name: "Contact Form",
      },
      reply_to: {
        email: replyTo,
        name: name,
      },
      subject: subject,
      content: [
        {
          type: "text/plain",
          value: textBody,
        },
        {
          type: "text/html",
          value: htmlBody,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Email sending failed: ${response.status} - ${error}`);
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
