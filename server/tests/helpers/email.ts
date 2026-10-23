import type { EmailSender } from "../../src/services/email/email.service.js";

export interface RecordedEmail {
  kind:
    | "otp"
    | "passwordReset"
    | "setPassword"
    | "setPasswordReminder"
    | "pendingApproval"
    | "mfaLogin"
    | "welcome"
    | "signupRejected";
  email: string;
  code?: string;
  url?: string;
  firstName?: string;
  expiresInHours?: number;
  expiresInMinutes?: number;
  hoursLeft?: number;
  reason?: string;
}

export interface MockEmailSender extends EmailSender {
  sent: RecordedEmail[];
  /** last raw OTP code sent to a given email, by kind */
  lastCode(email: string, kind?: RecordedEmail["kind"]): string | undefined;
  lastUrl(email: string): string | undefined;
}

export function createMockEmailSender(): MockEmailSender {
  const sent: RecordedEmail[] = [];
  return {
    sent,
    lastCode(email, kind = "otp") {
      for (let i = sent.length - 1; i >= 0; i--) {
        const entry = sent[i];
        if (entry.email === email && entry.kind === kind && entry.code) {
          return entry.code;
        }
      }
      return undefined;
    },
    lastUrl(email) {
      for (let i = sent.length - 1; i >= 0; i--) {
        const entry = sent[i];
        if (entry.email === email && entry.url) return entry.url;
      }
      return undefined;
    },
    async assertReady() {},
    async sendOtpEmail(email, code) {
      sent.push({ kind: "otp", email, code });
    },
    async sendPasswordResetEmail(email, firstName, url, expiresInMinutes) {
      sent.push({
        kind: "passwordReset",
        email,
        firstName,
        url,
        expiresInMinutes,
      });
    },
    async sendSetPasswordEmail(email, firstName, url, expiresInHours) {
      sent.push({ kind: "setPassword", email, firstName, url, expiresInHours });
    },
    async sendSetPasswordReminderEmail(email, firstName, url, hoursLeft) {
      sent.push({
        kind: "setPasswordReminder",
        email,
        firstName,
        url,
        hoursLeft,
      });
    },
    async sendPendingApprovalEmail(email, firstName) {
      sent.push({ kind: "pendingApproval", email, firstName });
    },
    async sendMfaLoginEmail(email, code) {
      sent.push({ kind: "mfaLogin", email, code });
    },
    async sendWelcomeEmail(email, firstName, url) {
      sent.push({ kind: "welcome", email, firstName, url });
    },
    async sendSignupRejectedEmail(email, firstName, reason) {
      sent.push({ kind: "signupRejected", email, firstName, reason });
    },
  };
}
