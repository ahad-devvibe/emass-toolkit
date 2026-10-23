import { randomUUID } from "node:crypto";
import { EmailDPClient } from "oci-emaildataplane";
import type * as emaildataplane from "oci-emaildataplane";
import {
  ConfigFileAuthenticationDetailsProvider,
  InstancePrincipalsAuthenticationDetailsProviderBuilder,
  NoRetryConfigurationDetails,
} from "oci-common";
import type { AuthenticationDetailsProvider } from "oci-common";
import {
  getEmailConfig,
  getEmailProvider,
  type EmailConfig,
} from "../../configs/email.js";
import { logger } from "../../configs/logger.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  renderOtpVerificationEmail,
  type RenderedEmail,
} from "./templates/otp-verification.template.js";
import { renderPasswordResetEmail } from "./templates/password-reset.template.js";
import { renderSetPasswordEmail } from "./templates/set-password.template.js";
import { renderSetPasswordReminderEmail } from "./templates/set-password-reminder.template.js";
import { renderPendingApprovalEmail } from "./templates/pending-approval.template.js";
import { renderMfaLoginEmail } from "./templates/mfa-login.template.js";
import { renderWelcomeEmail } from "./templates/welcome.template.js";
import { renderSignupRejectedEmail } from "./templates/signup-rejected.template.js";

export interface EmailSender {
  assertReady(): Promise<void>;
  sendOtpEmail(email: string, code: string): Promise<void>;
  sendPasswordResetEmail(
    email: string,
    firstName: string,
    url: string,
    expiresInMinutes: number,
  ): Promise<void>;
  // TODO(auth-otp-signup): the two set-password emails are unused since OTP
  // signup, remove later
  sendSetPasswordEmail(
    email: string,
    firstName: string,
    url: string,
    expiresInHours: number,
  ): Promise<void>;
  sendSetPasswordReminderEmail(
    email: string,
    firstName: string,
    url: string,
    hoursLeft: number,
  ): Promise<void>;
  sendPendingApprovalEmail(email: string, firstName: string): Promise<void>;
  sendMfaLoginEmail(email: string, code: string): Promise<void>;
  sendWelcomeEmail(
    email: string,
    firstName: string,
    catalogUrl: string,
  ): Promise<void>;
  sendSignupRejectedEmail(
    email: string,
    firstName: string,
    reason?: string,
  ): Promise<void>;
}

export interface EmailDeliveryClient {
  submitEmail(
    request: emaildataplane.requests.SubmitEmailRequest,
  ): Promise<unknown>;
}

type ClientFactory = (config: EmailConfig) => Promise<EmailDeliveryClient>;

async function createOciClient(
  config: EmailConfig,
): Promise<EmailDeliveryClient> {
  let authenticationDetailsProvider: AuthenticationDetailsProvider;

  if (config.authMode === "instance-principal") {
    authenticationDetailsProvider =
      await new InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  } else {
    authenticationDetailsProvider = new ConfigFileAuthenticationDetailsProvider(
      config.configFile,
      config.configProfile,
    );
  }

  const client = new EmailDPClient({ authenticationDetailsProvider });
  client.regionId = config.region;
  return client;
}

function createMessageId(fromAddress: string): string {
  return `${randomUUID()}@${fromAddress.split("@")[1]}`;
}

export function createOciEmailSender(
  clientFactory: ClientFactory = createOciClient,
  configFactory: () => EmailConfig = getEmailConfig,
): EmailSender {
  let clientPromise: Promise<EmailDeliveryClient> | undefined;

  async function submit(
    email: string,
    template: RenderedEmail,
    errorMessage: string,
  ): Promise<void> {
    const config = configFactory();
    clientPromise ??= clientFactory(config);

    try {
      const client = await clientPromise;
      await client.submitEmail({
        retryConfiguration: NoRetryConfigurationDetails,
        submitEmailDetails: {
          messageId: createMessageId(config.fromAddress),
          sender: {
            senderAddress: {
              email: config.fromAddress,
              name: config.fromName,
            },
            compartmentId: config.compartmentId,
          },
          recipients: { to: [{ email }] },
          subject: template.subject,
          bodyHtml: template.html,
          bodyText: template.text,
        },
      });
    } catch (error) {
      clientPromise = undefined;
      logger.error({ email, err: error }, "OCI email delivery failed");
      throw new ApiError(502, errorMessage, "EMAIL_SEND_FAILED");
    }
  }

  return {
    async assertReady(): Promise<void> {
      configFactory();
    },

    async sendOtpEmail(email: string, code: string): Promise<void> {
      const template = renderOtpVerificationEmail({
        code,
        expiresInMinutes: 10,
      });
      await submit(email, template, "Unable to send verification email");
    },

    async sendPasswordResetEmail(
      email: string,
      firstName: string,
      url: string,
      expiresInMinutes: number,
    ): Promise<void> {
      const template = renderPasswordResetEmail({
        firstName,
        url,
        expiresInMinutes,
      });
      await submit(email, template, "Unable to send password reset email");
    },

    async sendSetPasswordEmail(
      email: string,
      firstName: string,
      url: string,
      expiresInHours: number,
    ): Promise<void> {
      const template = renderSetPasswordEmail({
        firstName,
        url,
        expiresInHours,
      });
      await submit(email, template, "Unable to send set-password email");
    },

    async sendSetPasswordReminderEmail(
      email: string,
      firstName: string,
      url: string,
      hoursLeft: number,
    ): Promise<void> {
      const template = renderSetPasswordReminderEmail({
        firstName,
        url,
        hoursLeft,
      });
      await submit(
        email,
        template,
        "Unable to send set-password reminder email",
      );
    },

    async sendPendingApprovalEmail(
      email: string,
      firstName: string,
    ): Promise<void> {
      const template = renderPendingApprovalEmail({ firstName });
      await submit(email, template, "Unable to send pending approval email");
    },

    async sendMfaLoginEmail(email: string, code: string): Promise<void> {
      const template = renderMfaLoginEmail({ code, expiresInMinutes: 10 });
      await submit(email, template, "Unable to send login code email");
    },

    async sendWelcomeEmail(
      email: string,
      firstName: string,
      catalogUrl: string,
    ): Promise<void> {
      const template = renderWelcomeEmail({ firstName, catalogUrl });
      await submit(email, template, "Unable to send welcome email");
    },

    async sendSignupRejectedEmail(
      email: string,
      firstName: string,
      reason?: string,
    ): Promise<void> {
      const template = renderSignupRejectedEmail({ firstName, reason });
      await submit(email, template, "Unable to send signup rejected email");
    },
  };
}

export function createConsoleEmailSender(): EmailSender {
  return {
    async assertReady(): Promise<void> {
      // console sender is always ready
    },

    async sendOtpEmail(email: string, code: string): Promise<void> {
      logger.info({ email, code }, "console email sender: OTP email");
    },

    async sendPasswordResetEmail(
      email: string,
      _firstName: string,
      url: string,
    ): Promise<void> {
      logger.info({ email, url }, "console email sender: password reset email");
    },

    async sendSetPasswordEmail(
      email: string,
      firstName: string,
      url: string,
      expiresInHours: number,
    ): Promise<void> {
      logger.info(
        { email, firstName, url, expiresInHours },
        "console email sender: set-password email",
      );
    },

    async sendSetPasswordReminderEmail(
      email: string,
      firstName: string,
      url: string,
      hoursLeft: number,
    ): Promise<void> {
      logger.info(
        { email, firstName, url, hoursLeft },
        "console email sender: set-password reminder email",
      );
    },

    async sendPendingApprovalEmail(
      email: string,
      firstName: string,
    ): Promise<void> {
      logger.info(
        { email, firstName },
        "console email sender: pending approval email",
      );
    },

    async sendMfaLoginEmail(email: string, code: string): Promise<void> {
      logger.info({ email, code }, "console email sender: MFA login email");
    },

    async sendWelcomeEmail(
      email: string,
      firstName: string,
      catalogUrl: string,
    ): Promise<void> {
      logger.info(
        { email, firstName, catalogUrl },
        "console email sender: welcome email",
      );
    },

    async sendSignupRejectedEmail(
      email: string,
      firstName: string,
      reason?: string,
    ): Promise<void> {
      logger.info(
        { email, firstName, reason },
        "console email sender: signup rejected email",
      );
    },
  };
}

export function createEmailSender(): EmailSender {
  return getEmailProvider() === "oci"
    ? createOciEmailSender()
    : createConsoleEmailSender();
}

export const emailService: EmailSender = createEmailSender();
