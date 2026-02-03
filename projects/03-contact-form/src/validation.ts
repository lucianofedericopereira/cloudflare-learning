/**
 * Input validation and sanitization
 */

interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateContactForm(data: ContactFormData): ValidationResult {
  const errors: Record<string, string> = {};

  // Name validation
  if (!data.name || data.name.trim().length === 0) {
    errors.name = "Name is required";
  } else if (data.name.trim().length < 2) {
    errors.name = "Name must be at least 2 characters";
  } else if (data.name.trim().length > 100) {
    errors.name = "Name must be less than 100 characters";
  }

  // Email validation
  if (!data.email || data.email.trim().length === 0) {
    errors.email = "Email is required";
  } else if (!isValidEmail(data.email)) {
    errors.email = "Please enter a valid email address";
  }

  // Message validation
  if (!data.message || data.message.trim().length === 0) {
    errors.message = "Message is required";
  } else if (data.message.trim().length < 10) {
    errors.message = "Message must be at least 10 characters";
  } else if (data.message.trim().length > 5000) {
    errors.message = "Message must be less than 5000 characters";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function isValidEmail(email: string): boolean {
  // Basic email regex - good enough for most cases
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

export function sanitizeInput(input: string, maxLength = 1000): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // Remove control characters
}
