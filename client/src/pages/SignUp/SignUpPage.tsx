import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import { CircleHelp, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage, errorCode } from "@/auth/auth.messages"
import type { SignupInput } from "@/auth/auth.types"
import { useAuth } from "@/auth/useAuth"
import { AuthCard } from "@/components/common/AuthCard"
import { LegalNotice } from "@/components/common/LegalNotice"
import { FormAlert, FormField } from "@/components/common/FormField"
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils"
import { NewPasswordForm } from "@/components/common/NewPasswordForm"
import { OtpCodeForm } from "@/components/common/OtpCodeForm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { CountryCombobox } from "./components/CountryCombobox"
import { normalizeWebsite, WEBSITE_MESSAGE } from "./signup.utils"

// form → code (emailed) → password → signed in, or "request received" for personal addresses
type Step =
  | { kind: "form" }
  | { kind: "code"; email: string; error?: string }
  | { kind: "password"; email: string; code: string }
  | { kind: "pending"; email: string }

// Middle name is optional on the API; the form doesn't ask for it. Website is optional too ("" when not given)
type Form = Required<Omit<SignupInput, "middleName">>
type Field = keyof Form
type Errors = Partial<Record<Field, string>>

const emptyForm: Form = { email: "", firstName: "", lastName: "", country: "", companyName: "", website: "", jobTitle: "", useCase: "", captcha: "" }

// Same limits as the server's signupSchema
const USE_CASE_MIN = 10
const USE_CASE_MAX = 200

const required: Record<Exclude<Field, "website">, string> = {
  email: "Email is required",
  firstName: "First name is required",
  lastName: "Last name is required",
  country: "Choose your country",
  companyName: "Company is required",
  jobTitle: "Job title is required",
  useCase: "Tell us what you'll use EMASS for",
  captcha: "Enter the characters shown",
}

function validate(form: Form): Errors {
  const errors: Errors = {}
  for (const [field, message] of Object.entries(required) as [Field, string][]) {
    if (!form[field].trim()) errors[field] = message
  }
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = "Enter a valid email address"
  const useCase = form.useCase.trim()
  if (useCase && useCase.length < USE_CASE_MIN) errors.useCase = `Tell us a bit more (at least ${USE_CASE_MIN} characters)`
  if (form.website.trim() && !normalizeWebsite(form.website)) errors.website = WEBSITE_MESSAGE
  return errors
}

// Server zod errors arrive as { field: [messages] }; show the first per field
function serverFieldErrors(error: ApiRequestError): Errors {
  return Object.fromEntries(Object.entries(error.fieldErrors).flatMap(([field, messages]) => (messages?.[0] ? [[field, messages[0]]] : [])))
}

export function SignUpPage() {
  const [step, setStep] = useState<Step>({ kind: "form" })
  // Kept here so "Use a different email" returns to a filled-in form
  const [form, setForm] = useState<Form>(emptyForm)

  if (step.kind === "code") return <CodeStep email={step.email} initialError={step.error} onVerified={(code) => setStep({ kind: "password", email: step.email, code })} onBack={() => setStep({ kind: "form" })} />
  if (step.kind === "password") return <PasswordStep email={step.email} code={step.code} onPending={() => setStep({ kind: "pending", email: step.email })} onCodeRejected={(error) => setStep({ kind: "code", email: step.email, error })} />
  if (step.kind === "pending") return <RequestReceived email={step.email} />
  return <SignupForm form={form} setForm={setForm} onCodeSent={(email) => setStep({ kind: "code", email })} />
}

type SignupFormProps = { form: Form; setForm: Dispatch<SetStateAction<Form>>; onCodeSent: (email: string) => void }

function SignupForm({ form, setForm, onCodeSent }: SignupFormProps) {
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [captchaImage, setCaptchaImage] = useState<string | null>(null)
  const [captchaError, setCaptchaError] = useState(false)
  // Bumping the key fetches a new captcha (and a new captcha cookie)
  const [captchaKey, setCaptchaKey] = useState(0)

  useEffect(() => {
    let active = true
    authApi.captcha().then(
      ({ image }) => active && setCaptchaImage(image),
      () => active && setCaptchaError(true),
    )
    return () => {
      active = false
    }
  }, [captchaKey])

  function loadCaptcha() {
    setCaptchaImage(null)
    setCaptchaError(false)
    setCaptchaKey((key) => key + 1)
  }

  const update = (field: Field) => (value: string) => setForm((current) => ({ ...current, [field]: value }))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    setFormError("")
    if (Object.keys(nextErrors).length > 0) return
    setSubmitting(true)
    try {
      const { website, ...rest } = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as Form
      // Sent as the full address (https://acme.com), and only when given
      const { email } = await authApi.signup({ ...rest, ...(website && { website: normalizeWebsite(website)! }) })
      // The captcha is used up; a return to the form needs a fresh one
      setForm((current) => ({ ...current, captcha: "" }))
      onCodeSent(email)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === "EMAIL_TAKEN") setErrors({ email: authErrorMessage(error) })
        else if (error.code.startsWith("CAPTCHA_")) setErrors({ captcha: authErrorMessage(error) })
        else if (error.code === "VALIDATION_ERROR") setErrors(serverFieldErrors(error))
        else setFormError(authErrorMessage(error))
      } else setFormError(authErrorMessage(error))
      // A captcha is single-use: any failed attempt needs a fresh one
      setForm((current) => ({ ...current, captcha: "" }))
      loadCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      wide
      title="Request Access"
      description="Fill in the form to verify your email and request access."
      dividerFooter
      footer={
        <span className="flex items-center gap-3">
          <span aria-hidden className="h-px flex-1 bg-[#0d72b9]/25 dark:bg-[#7cc6f8]/25" />
          <span className="shrink-0">Already have an account? <Link to="/sign-in" className="font-medium text-primary hover:underline">Sign in</Link></span>
          <span aria-hidden className="h-px flex-1 bg-[#0d72b9]/25 dark:bg-[#7cc6f8]/25" />
        </span>
      }
    >
      {/* Container queries size the rows by the card's own width, so the form works from small laptops to desktop */}
      <form noValidate onSubmit={handleSubmit} className="@container space-y-3 short:space-y-2.5 compact:space-y-2 tiny:space-y-1.5">
        {formError && <FormAlert>{formError}</FormAlert>}
        <div className="grid items-start gap-3 @[36rem]:grid-cols-3">
          <FormField id="firstName" label="First name" required error={errors.firstName}>
            <Input {...fieldA11y("firstName", errors.firstName)} autoComplete="given-name" maxLength={80} placeholder="Jane" value={form.firstName} onChange={(event) => update("firstName")(event.target.value)} />
          </FormField>
          <FormField id="lastName" label="Last name" required error={errors.lastName}>
            <Input {...fieldA11y("lastName", errors.lastName)} autoComplete="family-name" maxLength={80} placeholder="Doe" value={form.lastName} onChange={(event) => update("lastName")(event.target.value)} />
          </FormField>
          <FormField
            id="email"
            label="Email"
            required
            error={errors.email}
            labelAside={
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Email domain access policy" />}>
                    <CircleHelp />
                  </TooltipTrigger>
                  <TooltipContent>Custom email domains get instant access. Free email addresses are added to the approval list.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
          >
            <Input {...fieldA11y("email", errors.email)} type="email" autoComplete="email" placeholder="johndoe@example.com" value={form.email} onChange={(event) => update("email")(event.target.value)} />
          </FormField>
        </div>
        <div className="grid items-start gap-3 @[36rem]:grid-cols-3">
          <FormField id="companyName" label="Company" required error={errors.companyName}>
            <Input {...fieldA11y("companyName", errors.companyName)} autoComplete="organization" maxLength={120} placeholder="Acme Inc." value={form.companyName} onChange={(event) => update("companyName")(event.target.value)} />
          </FormField>
          <FormField id="website" label="Website" optional error={errors.website}>
            <Input {...fieldA11y("website", errors.website)} type="url" inputMode="url" autoComplete="url" maxLength={255} placeholder="acme.com" value={form.website} onChange={(event) => update("website")(event.target.value)} />
          </FormField>
          <FormField id="jobTitle" label="Job title" required error={errors.jobTitle}>
            <Input {...fieldA11y("jobTitle", errors.jobTitle)} autoComplete="organization-title" maxLength={120} placeholder="Software Engineer" value={form.jobTitle} onChange={(event) => update("jobTitle")(event.target.value)} />
          </FormField>
        </div>
        <div className="grid items-start gap-3 @[36rem]:grid-cols-3">
          <FormField id="country" label="Country" required error={errors.country}>
            <CountryCombobox id="country" value={form.country} onChange={update("country")} invalid={Boolean(errors.country)} describedBy={errors.country ? "country-error" : undefined} />
          </FormField>
          <FormField
          id="useCase"
          className="@[36rem]:col-span-2"
          label="What will you use EMASS for?"
          required
          error={errors.useCase}
          labelAside={<span className={cn("text-xs tabular-nums text-muted-foreground", form.useCase.length >= USE_CASE_MAX && "text-destructive")}>{form.useCase.length}/{USE_CASE_MAX}</span>}
        >
          <Textarea {...fieldA11y("useCase", errors.useCase)} rows={2} maxLength={USE_CASE_MAX} placeholder="e.g. Evaluating EMASS for a battery-powered vision sensor" className="max-h-40 min-h-16 short:min-h-14 compact:min-h-12" value={form.useCase} onChange={(event) => update("useCase")(event.target.value)} />
          </FormField>
        </div>

        <FormField id="captcha" label="Type the characters you see" required error={errors.captcha}>
          <div className="flex items-center gap-3">
            {/* The image carries its own light tint, so it stays legible in dark mode too */}
            <div className="grid h-12 w-[156px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#EEF4FB] ring-1 ring-[#4aa8ff]/27 short:h-11 short:w-[143px] compact:h-10 compact:w-[130px] tiny:h-9 tiny:w-[117px]">
              {captchaImage ? <img src={captchaImage} alt="Verification characters" width={180} height={56} className="size-full object-contain" /> : captchaError ? <span className="px-2 text-center text-xs text-destructive">Couldn't load the image</span> : <Loader2 className="size-4 animate-spin text-slate-500" />}
            </div>
            <Button type="button" variant="outline" size="icon" className="size-11 shrink-0 rounded-xl compact:size-10 tiny:size-9" aria-label="Load a new image" title="Load a new image" onClick={loadCaptcha}><RefreshCw className={cn(!captchaImage && !captchaError && "animate-spin")} /></Button>
            <Input {...fieldA11y("captcha", errors.captcha)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={6} placeholder="ABC123" className="min-w-0 flex-1 font-mono uppercase tracking-[0.3em] placeholder:tracking-[0.3em]" value={form.captcha} onChange={(event) => update("captcha")(event.target.value)} />
          </div>
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Sending code…" : "Continue"}</Button>
        <LegalNotice action="requesting access" />
      </form>
    </AuthCard>
  )
}

const emailLine = (email: string) => <>We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.</>

function CodeStep({ email, initialError, onVerified, onBack }: { email: string; initialError?: string; onVerified: (code: string) => void; onBack: () => void }) {
  return (
    <AuthCard title="Check your email" description={emailLine(email)}>
      <OtpCodeForm
        submitLabel="Verify email"
        submittingLabel="Verifying…"
        initialError={initialError}
        onVerify={async (code) => {
          await authApi.signupVerify(email, code)
          onVerified(code)
        }}
        onResend={() => authApi.resendSignupCode(email)}
        onCancel={onBack}
        cancelLabel="Use a different email"
      />
    </AuthCard>
  )
}

function PasswordStep({ email, code, onPending, onCodeRejected }: { email: string; code: string; onPending: () => void; onCodeRejected: (message: string) => void }) {
  const { completeSignup } = useAuth()

  async function submit(password: string) {
    try {
      // Signed in: GuestOnly redirects to the user's home
      const { signedIn } = await completeSignup(email, code, password)
      if (!signedIn) onPending()
    } catch (error) {
      // The code expired or ran out while choosing a password: get a new one
      if (errorCode(error)?.startsWith("OTP_")) onCodeRejected(authErrorMessage(error))
      else throw error
    }
  }

  return (
    <AuthCard title="Choose a password" description={<>Your email is verified. Set a password for <span className="font-medium text-foreground">{email}</span>.</>}>
      <NewPasswordForm email={email} submitLabel="Create account" submittingLabel="Creating account…" onSubmit={submit} />
    </AuthCard>
  )
}

function RequestReceived({ email }: { email: string }) {
  return (
    <AuthCard title="Request received" footer={<Link to="/sign-in" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
      <div className="space-y-3 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-6" /></span>
        <p className="text-sm text-muted-foreground">Our team reviews sign-ups from personal email addresses. We'll email <span className="font-medium text-foreground">{email}</span> once your access is approved, usually within one business day. Then sign in with the password you just set.</p>
      </div>
    </AuthCard>
  )
}
