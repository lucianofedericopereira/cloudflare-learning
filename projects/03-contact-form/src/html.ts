/**
 * HTML template for the contact form
 */

export function getContactFormHtml(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Us</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      width: 100%;
      max-width: 500px;
      padding: 40px;
    }

    h1 {
      color: #1f2937;
      font-size: 28px;
      margin-bottom: 8px;
      text-align: center;
    }

    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 32px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      color: #374151;
      font-weight: 500;
      margin-bottom: 6px;
    }

    input, textarea {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input:focus, textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    textarea {
      min-height: 120px;
      resize: vertical;
    }

    .honeypot {
      position: absolute;
      left: -9999px;
    }

    button {
      width: 100%;
      padding: 14px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -10px rgba(102, 126, 234, 0.5);
    }

    button:active {
      transform: translateY(0);
    }

    button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none;
    }

    .message {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }

    .message.success {
      background: #d1fae5;
      color: #065f46;
      display: block;
    }

    .message.error {
      background: #fee2e2;
      color: #991b1b;
      display: block;
    }

    .error-text {
      color: #dc2626;
      font-size: 14px;
      margin-top: 4px;
    }

    .powered-by {
      text-align: center;
      margin-top: 24px;
      color: #9ca3af;
      font-size: 12px;
    }

    .powered-by a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Get in Touch</h1>
    <p class="subtitle">We'd love to hear from you. Send us a message!</p>

    <div id="message" class="message"></div>

    <form id="contactForm" action="/api/contact" method="POST">
      <div class="form-group">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" required minlength="2" maxlength="100" placeholder="Your name">
        <div class="error-text" id="nameError"></div>
      </div>

      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="your@email.com">
        <div class="error-text" id="emailError"></div>
      </div>

      <div class="form-group">
        <label for="message">Message</label>
        <textarea id="messageInput" name="message" required minlength="10" maxlength="5000" placeholder="Your message..."></textarea>
        <div class="error-text" id="messageError"></div>
      </div>

      <!-- Honeypot field -->
      <div class="honeypot">
        <input type="text" name="website" tabindex="-1" autocomplete="off">
      </div>

      <button type="submit" id="submitBtn">Send Message</button>
    </form>

    <p class="powered-by">
      Powered by <a href="https://workers.cloudflare.com" target="_blank">Cloudflare Workers</a>
    </p>
  </div>

  <script>
    const form = document.getElementById('contactForm');
    const submitBtn = document.getElementById('submitBtn');
    const messageDiv = document.getElementById('message');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Clear previous errors
      document.querySelectorAll('.error-text').forEach(el => el.textContent = '');
      messageDiv.className = 'message';
      messageDiv.style.display = 'none';

      // Disable button
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (response.ok) {
          messageDiv.textContent = result.message;
          messageDiv.className = 'message success';
          form.reset();
        } else {
          if (result.errors) {
            // Show field-specific errors
            for (const [field, error] of Object.entries(result.errors)) {
              const errorEl = document.getElementById(field + 'Error');
              if (errorEl) errorEl.textContent = error;
            }
          }
          messageDiv.textContent = result.error || 'Something went wrong. Please try again.';
          messageDiv.className = 'message error';
        }
      } catch (error) {
        messageDiv.textContent = 'Network error. Please check your connection and try again.';
        messageDiv.className = 'message error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
      }
    });
  </script>
</body>
</html>
  `.trim();
}
