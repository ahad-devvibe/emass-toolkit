import type { ReactNode } from "react"
import { Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { CountryFlag } from "@/components/common/CountryFlag"
import { UserAvatar } from "@/components/common/UserAvatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { countryLabel } from "@/lib/countries/countries"
import { displayWebsite } from "@/pages/SignUp/signup.utils"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import { relativeTime } from "@/pages/Releases/releases.utils"
import type { Customer } from "./customers.api"
import { CustomerStatusBadge } from "./CustomerStatusBadge"
import { blockReasonLabels, formatCount, formatExact, fullName } from "./customers.utils"

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="border-b pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

const none = <span className="text-muted-foreground">—</span>

/**
 * A download as one compact row: the date (and how long ago), then what was
 * downloaded on one line. Real file names are long, so the line truncates and
 * the full "Product vX — file" label shows on hover.
 */
function DownloadMoment({ at, file }: { at: string | null; file: string | null }) {
  if (!at) return <span className="text-muted-foreground">Never</span>
  return (
    <>
      <span>{shortDate(at)} <span className="text-muted-foreground">({relativeTime(at)})</span></span>
      {file && <span title={file} className="block truncate text-xs text-muted-foreground">{file}</span>}
    </>
  )
}

/** Everything stored on a customer's account; read-only. */
export function CustomerDetailsDialog({ customer, onOpenChange }: { customer: Customer | null; onOpenChange: (open: boolean) => void }) {
  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email)
      toast.success("Email copied to clipboard")
    } catch {
      toast.error("Clipboard access is unavailable in this browser")
    }
  }

  return (
    <Dialog open={customer !== null} onOpenChange={onOpenChange}>
      {/* overflow-y stays only as a fallback for short screens */}
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-xl">
        {customer && (
          <>
            <DialogHeader className="flex-row items-center gap-3 border-b pb-4 pr-8">
              <UserAvatar user={customer} className="size-11 text-sm" />
              <div className="min-w-0 space-y-1">
                <DialogTitle className="truncate">{fullName(customer)}</DialogTitle>
                <DialogDescription className="truncate">{customer.jobTitle} · {customer.companyName}</DialogDescription>
              </div>
            </DialogHeader>

            <Section title="Profile">
              <dl className="divide-y">
                <Field label="Email">
                  <span className="inline-flex max-w-full items-center gap-1.5"><span className="min-w-0 [overflow-wrap:anywhere]">{customer.email}</span><button type="button" aria-label="Copy email" title="Copy email" onClick={() => void copyEmail(customer.email)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" /></button></span>
                </Field>
                <Field label="Country"><span className="inline-flex items-center gap-2"><CountryFlag code={customer.country} />{countryLabel(customer.country)}</span></Field>
                <Field label="Company">{customer.companyName}</Field>
                <Field label="Job title">{customer.jobTitle}</Field>
                <Field label="Website">
                  {customer.website ? <a href={customer.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{displayWebsite(customer.website)}<ExternalLink aria-hidden className="size-3" /><span className="sr-only"> (opens in a new tab)</span></a> : none}
                </Field>
                {/* Long answers are clamped to keep the dialog short; hover shows the rest */}
                <Field label="Use case">{customer.useCase ? <span title={customer.useCase} className="line-clamp-3 whitespace-pre-line">{customer.useCase}</span> : none}</Field>
              </dl>
            </Section>

            <Section title="Account">
              <dl className="divide-y">
                <Field label="Status">
                  <span className="inline-flex flex-wrap items-center gap-2"><CustomerStatusBadge status={customer.status} />{customer.blockReason && <span className="text-xs text-muted-foreground">{blockReasonLabels[customer.blockReason]}</span>}</span>
                </Field>
                <Field label="Email verified">{customer.emailVerified ? "Yes" : "No"}</Field>
                <Field label="Joined">{shortDate(customer.createdAt)} <span className="text-muted-foreground">({relativeTime(customer.createdAt)})</span></Field>
                <Field label="Licence accepted">{customer.licenseAcceptedAt ? shortDate(customer.licenseAcceptedAt) : <span className="text-muted-foreground">Not yet</span>}</Field>
              </dl>
            </Section>

            <Section title="Downloads">
              <dl className="divide-y">
                <Field label="Total">
                  <span className="tabular-nums" title={`${formatExact(customer.downloadCount)} downloads`}>{formatCount(customer.downloadCount)}{customer.downloadCount >= 1000 && <span className="ml-1.5 text-muted-foreground">({formatExact(customer.downloadCount)})</span>}</span>
                </Field>
                <Field label="First download"><DownloadMoment at={customer.firstDownloadAt} file={customer.firstDownloadLabel} /></Field>
                <Field label="Last download"><DownloadMoment at={customer.lastDownloadAt} file={customer.lastDownloadLabel} /></Field>
              </dl>
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
