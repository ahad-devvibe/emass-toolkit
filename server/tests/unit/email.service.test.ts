import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { logger } from "../../src/configs/logger.js";
import {
  createConsoleEmailSender,
  createOciEmailSender,
  type EmailDeliveryClient,
} from "../../src/services/email/email.service.js";
import type { EmailConfig } from "../../src/configs/email.js";

const config: EmailConfig = {
  provider: "oci",
  fromAddress: "no-reply@example.com",
  fromName: "EMASS Toolkit",
  region: "us-phoenix-1",
  compartmentId: "ocid1.compartment.example",
  authMode: "config-file",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createOciEmailSender", () => {
  it("submits an OTP email through OCI", async () => {
    const submitEmail = vi.fn().mockResolvedValue({});
    const client: EmailDeliveryClient = { submitEmail };
    const sender = createOciEmailSender(
      async () => client,
      () => config,
    );

    await sender.sendOtpEmail("user@example.com", "123456");

    expect(submitEmail).toHaveBeenCalledOnce();
    const request = submitEmail.mock.calls[0][0];
    expect(request.retryConfiguration).toBeDefined();
    expect(request.submitEmailDetails.sender).toEqual({
      senderAddress: { email: config.fromAddress, name: config.fromName },
      compartmentId: config.compartmentId,
    });
    expect(request.submitEmailDetails.recipients).toEqual({
      to: [{ email: "user@example.com" }],
    });
    expect(request.submitEmailDetails.subject).toBe(
      "Your EMASS Toolkit verification code",
    );
    expect(request.submitEmailDetails.bodyHtml).toContain("123456");
    expect(request.submitEmailDetails.bodyText).toContain("123456");
    expect(request.submitEmailDetails.bodyText).toContain("10 minutes");
  });

  it("creates the OCI client only once", async () => {
    const submitEmail = vi.fn().mockResolvedValue({});
    const client: EmailDeliveryClient = { submitEmail };
    const clientFactory = vi.fn().mockResolvedValue(client);
    const sender = createOciEmailSender(clientFactory, () => config);

    await sender.sendOtpEmail("one@example.com", "123456");
    await sender.sendOtpEmail("two@example.com", "654321");

    expect(clientFactory).toHaveBeenCalledOnce();
  });

  it("rebuilds the OCI client after a failed send instead of caching the failure", async () => {
    const failingClient: EmailDeliveryClient = {
      submitEmail: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const workingClient: EmailDeliveryClient = {
      submitEmail: vi.fn().mockResolvedValue({}),
    };
    const clientFactory = vi
      .fn()
      .mockResolvedValueOnce(failingClient)
      .mockResolvedValueOnce(workingClient);
    const sender = createOciEmailSender(clientFactory, () => config);
    const errorLog = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      sender.sendOtpEmail("first@example.com", "123456"),
    ).rejects.toMatchObject({
      code: "EMAIL_SEND_FAILED",
    });
    await sender.sendOtpEmail("second@example.com", "654321");

    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(workingClient.submitEmail).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("translates OCI failures without exposing provider details", async () => {
    const providerError = new Error("private OCI provider details");
    const client: EmailDeliveryClient = {
      submitEmail: vi.fn().mockRejectedValue(providerError),
    };
    const sender = createOciEmailSender(
      async () => client,
      () => config,
    );
    const errorLog = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      sender.sendOtpEmail("user@example.com", "123456"),
    ).rejects.toEqual(
      new ApiError(
        502,
        "Unable to send verification email",
        "EMAIL_SEND_FAILED",
      ),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls[0][1]).not.toHaveProperty("code");
  });

  it("does not call OCI when configuration is missing", async () => {
    const clientFactory = vi.fn();
    const sender = createOciEmailSender(clientFactory, () => {
      throw new ApiError(
        500,
        "Email configuration is missing: EMAIL_FROM_ADDRESS",
        "EMAIL_CONFIG_MISSING",
      );
    });

    await expect(
      sender.sendOtpEmail("user@example.com", "123456"),
    ).rejects.toMatchObject({
      code: "EMAIL_CONFIG_MISSING",
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("submits a password reset email through OCI", async () => {
    const submitEmail = vi.fn().mockResolvedValue({});
    const client: EmailDeliveryClient = { submitEmail };
    const sender = createOciEmailSender(
      async () => client,
      () => config,
    );

    await sender.sendPasswordResetEmail(
      "user@example.com",
      "Jane",
      "https://portal.example.com/reset-password?token=abc",
      30,
    );

    expect(submitEmail).toHaveBeenCalledOnce();
    const request = submitEmail.mock.calls[0][0];
    expect(request.submitEmailDetails.recipients).toEqual({
      to: [{ email: "user@example.com" }],
    });
    expect(request.submitEmailDetails.subject).toBe(
      "Reset your EMASS Toolkit password",
    );
    expect(request.submitEmailDetails.bodyHtml).toContain(
      "https://portal.example.com/reset-password?token=abc",
    );
    expect(request.submitEmailDetails.bodyText).toContain(
      "https://portal.example.com/reset-password?token=abc",
    );
    expect(request.submitEmailDetails.bodyText).toContain("30 minutes");
  });

  it("translates reset email failures without exposing provider details", async () => {
    const client: EmailDeliveryClient = {
      submitEmail: vi
        .fn()
        .mockRejectedValue(new Error("private OCI provider details")),
    };
    const sender = createOciEmailSender(
      async () => client,
      () => config,
    );
    const errorLog = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      sender.sendPasswordResetEmail(
        "user@example.com",
        "Jane",
        "https://portal.example.com/reset-password?token=abc",
        30,
      ),
    ).rejects.toEqual(
      new ApiError(
        502,
        "Unable to send password reset email",
        "EMAIL_SEND_FAILED",
      ),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});

describe("createConsoleEmailSender", () => {
  it("accepts sends without throwing and is always ready", async () => {
    const sender = createConsoleEmailSender();
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await expect(sender.assertReady()).resolves.toBeUndefined();
    await expect(
      sender.sendOtpEmail("user@example.com", "123456"),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendPasswordResetEmail(
        "user@example.com",
        "Jane",
        "https://portal.example.com/reset-password?token=abc",
        30,
      ),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendSetPasswordEmail(
        "user@example.com",
        "Jane",
        "http://localhost:5173/set-password?token=t",
        48,
      ),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendSetPasswordReminderEmail(
        "user@example.com",
        "Jane",
        "http://localhost:5173/set-password?token=t",
        24,
      ),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendPendingApprovalEmail("user@example.com", "Jane"),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendMfaLoginEmail("user@example.com", "123456"),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendWelcomeEmail(
        "user@example.com",
        "Jane",
        "http://localhost:5173/catalog",
      ),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendSignupRejectedEmail("user@example.com", "Jane", "Not a fit"),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(8);
  });
});
