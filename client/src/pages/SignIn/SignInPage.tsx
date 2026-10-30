import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { authErrorMessage } from "@/auth/auth.messages";
import { useAuth } from "@/auth/useAuth";
import { AuthCard } from "@/components/common/AuthCard";
import { LegalNotice } from "@/components/common/LegalNotice";
import { FormAlert, FormField } from "@/components/common/FormField";
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MfaStep } from "./components/MfaStep";

type FieldErrors = { email?: string; password?: string };

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Email is required";
  else if (!EMAIL_PATTERN.test(email.trim()))
    errors.email = "Enter a valid email address";
  if (!password) errors.password = "Password is required";
  return errors;
}

// Lets another page send the user here with the email filled in and a notice
type SignInState = { email?: string; notice?: string } | null;

export function SignInPage() {
  const { signIn } = useAuth();
  const location = useLocation();
  const initial = location.state as SignInState;
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(initial?.notice ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [mfaEmail, setMfaEmail] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate(email, password);
    setFieldErrors(errors);
    setFormError("");
    setNotice("");
    if (errors.email || errors.password) return;
    setSubmitting(true);
    try {
      const { mfaRequired } = await signIn(email.trim(), password);
      // Without MFA the user is now set and GuestOnly redirects
      if (mfaRequired) setMfaEmail(email.trim());
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (mfaEmail) {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a 6-digit code to{" "}
            <span className="font-medium text-foreground">{mfaEmail}</span>.
          </>
        }
      >
        <MfaStep
          email={mfaEmail}
          onCancel={() => {
            setMfaEmail(null);
            setPassword("");
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="SIGN IN TO"
      title="Your EMASS Account"
      description="Access the tools and documentation you need to build on EMASS, and stay informed as new releases and updates are published."
      descriptionClassName="text-sm text-muted-foreground sm:text-base dark:text-muted-foreground"
      largeBrand
      introLeft
      roomy
      footer={
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className="h-px flex-1 bg-[#0d72b9]/25 dark:bg-[#7cc6f8]/25"
          />
          <span className="shrink-0">
            New to EMASS?{" "}
            <Link
              to="/sign-up"
              className="font-medium text-primary hover:underline"
            >
              Request access
            </Link>
          </span>
          <span
            aria-hidden
            className="h-px flex-1 bg-[#0d72b9]/25 dark:bg-[#7cc6f8]/25"
          />
        </span>
      }
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="space-y-6 short:space-y-5"
      >
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        {formError && <FormAlert>{formError}</FormAlert>}
        <FormField id="email" label="Email" error={fieldErrors.email}>
          <Input
            {...fieldA11y("email", fieldErrors.email)}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="h-10"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={fieldErrors.password}
          labelAside={
            <Link
              to="/forgot-password"
              state={{ email: email.trim() }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            {...fieldA11y("password", fieldErrors.password)}
            autoComplete="current-password"
            placeholder="Enter Your Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={submitting}
        >
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <LegalNotice action="signing in" />
      </form>
    </AuthCard>
  );
}
