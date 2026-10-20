import { useEffect, useState, type FormEvent } from "react"
import { Loader2, MailCheck, RefreshCw, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage } from "@/auth/auth.messages"
import type { SignupInput, UserStatus } from "@/auth/auth.types"
import { AuthCard } from "@/components/common/AuthCard"
import { FormAlert, FormField } from "@/components/common/FormField"
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { CountryCombobox } from "./components/CountryCombobox"

type Form = Required<SignupInput>
type Field = keyof Form
type Errors = Partial<Record<Field, string>>

const emptyForm: Form = { email: "", firstName: "", middleName: "", lastName: "", country: "", companyName: "", jobTitle: "", captcha: "" }

const required: Record<Exclude<Field, "middleName">, string> = {
  email: "Work email is required",
  firstName: "First name is required",
  lastName: "Last name is required",
  country: "Choose your country",
  companyName: "Company is required",
  jobTitle: "Job title is required",
  captcha: "Enter the characters shown",
}

function validate(form: Form): Errors {
  const errors: Errors = {}
  for (const [field, message] of Object.entries(required) as [Field, string][]) {
    if (!form[field].trim()) errors[field] = message
  }
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = "Enter a valid email address"
  return errors
}

// Server zod errors arrive as { field: [messages] }; show the first per field
function serverFieldErrors(error: ApiRequestError): Errors {
  return Object.fromEntries(Object.entries(error.fieldErrors).flatMap(([field, messages]) => (messages?.[0] ? [[field, messages[0]]] : [])))
}

export function SignUpPage() {
  const [form, setForm] = useState<Form>(emptyForm)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [captchaImage, setCaptchaImage] = useState<string | null>(null)
  const [captchaError, setCaptchaError] = useState(false)
  const [created, setCreated] = useState<{ email: string; status: UserStatus } | null>(null)
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
      const { middleName, ...rest } = form
      const trimmed = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value.trim()])) as Omit<Form, "middleName">
      const user = await authApi.signup({ ...trimmed, ...(middleName.trim() ? { middleName: middleName.trim() } : {}) })
      setCreated({ email: user.email, status: user.status })
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

  if (created) {
    const pending = created.status === "PENDING_APPROVAL"
    const Icon = pending ? ShieldCheck : MailCheck
    return (
      <AuthCard title={pending ? "Request received" : "Check your email"} footer={<Link to="/sign-in" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
        <div className="space-y-3 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-6" /></span>
          {pending
            ? <p className="text-sm text-muted-foreground">Our team reviews sign-ups from personal email addresses. We'll email <span className="font-medium text-foreground">{created.email}</span> once your access is approved, usually within one business day.</p>
            : <p className="text-sm text-muted-foreground">We sent a link to <span className="font-medium text-foreground">{created.email}</span>. Open it to set your password and finish creating your account. The link expires in 48 hours.</p>}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard wide title="Request access" description="Create an account to download EMASS SDKs and documentation." footer={<>Already have an account? <Link to="/sign-in" className="font-medium text-primary hover:underline">Sign in</Link></>}>
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {formError && <FormAlert>{formError}</FormAlert>}
        <FormField id="email" label="Work email" error={errors.email} hint="Company addresses get access right away. Personal addresses are reviewed first.">
          <Input {...fieldA11y("email", errors.email)} type="email" autoComplete="email" placeholder="you@company.com" className="h-10" value={form.email} onChange={(event) => update("email")(event.target.value)} />
        </FormField>
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <FormField id="firstName" label="First name" error={errors.firstName}>
            <Input {...fieldA11y("firstName", errors.firstName)} autoComplete="given-name" maxLength={80} className="h-10" value={form.firstName} onChange={(event) => update("firstName")(event.target.value)} />
          </FormField>
          <FormField id="middleName" label="Middle name" error={errors.middleName}>
            <Input {...fieldA11y("middleName", errors.middleName)} autoComplete="additional-name" maxLength={80} placeholder="Optional" className="h-10" value={form.middleName} onChange={(event) => update("middleName")(event.target.value)} />
          </FormField>
          <FormField id="lastName" label="Last name" error={errors.lastName}>
            <Input {...fieldA11y("lastName", errors.lastName)} autoComplete="family-name" maxLength={80} className="h-10" value={form.lastName} onChange={(event) => update("lastName")(event.target.value)} />
          </FormField>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <FormField id="companyName" label="Company" error={errors.companyName}>
            <Input {...fieldA11y("companyName", errors.companyName)} autoComplete="organization" maxLength={120} className="h-10" value={form.companyName} onChange={(event) => update("companyName")(event.target.value)} />
          </FormField>
          <FormField id="jobTitle" label="Job title" error={errors.jobTitle}>
            <Input {...fieldA11y("jobTitle", errors.jobTitle)} autoComplete="organization-title" maxLength={120} className="h-10" value={form.jobTitle} onChange={(event) => update("jobTitle")(event.target.value)} />
          </FormField>
        </div>
        <FormField id="country" label="Country" error={errors.country}>
          <CountryCombobox id="country" value={form.country} onChange={update("country")} invalid={Boolean(errors.country)} describedBy={errors.country ? "country-error" : undefined} />
        </FormField>

        <div className="rounded-xl bg-muted/50 p-4 ring-1 ring-border">
          <FormField id="captcha" label="Type the characters you see" error={errors.captcha}>
            <div className="flex flex-wrap items-center gap-3">
              {/* The image carries its own light tint, so it stays legible in dark mode too */}
              <div className="grid h-14 w-[180px] shrink-0 place-items-center overflow-hidden rounded-lg bg-[#EEF4FB] ring-1 ring-border">
                {captchaImage ? <img src={captchaImage} alt="Verification characters" width={180} height={56} className="size-full" /> : captchaError ? <span className="px-2 text-center text-xs text-destructive">Couldn't load the image</span> : <Loader2 className="size-4 animate-spin text-slate-500" />}
              </div>
              <Button type="button" variant="outline" size="icon" aria-label="Load a new image" title="Load a new image" onClick={loadCaptcha}><RefreshCw className={cn(!captchaImage && !captchaError && "animate-spin")} /></Button>
              <Input {...fieldA11y("captcha", errors.captcha)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={6} placeholder="ABC123" className="h-10 w-full bg-card font-mono uppercase tracking-[0.3em] placeholder:tracking-[0.3em] sm:w-36 sm:flex-1" value={form.captcha} onChange={(event) => update("captcha")(event.target.value)} />
            </div>
          </FormField>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Creating account…" : "Create account"}</Button>
      </form>
    </AuthCard>
  )
}
