import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Inbox, Loader2, RefreshCw, Search, UserX, X } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import type { SessionUser } from "@/auth/auth.types"
import { authErrorMessage, errorCode } from "@/auth/auth.messages"
import { AppShell } from "@/components/common/AppShell"
import { CountryFlag } from "@/components/common/CountryFlag"
import { ApproveDialog, ReasonDialog } from "@/components/common/dialogs"
import { UserAvatar } from "@/components/common/UserAvatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { countryLabel } from "@/lib/countries/countries"
import { cn } from "@/lib/utils"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { loadMoreSignups, loadPendingSignups, removePendingSignup, usePendingSignups } from "./pendingSignups.store"
import { PAGE_SIZE, signupsApi } from "./signups.api"

type Decision = { kind: "approve" | "reject"; signup: SessionUser }

const fullName = (user: SessionUser) => [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ")

function SignupRow({ signup, onDecide }: { signup: SessionUser; onDecide: (kind: Decision["kind"]) => void }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <UserAvatar user={signup} className="mt-0.5 size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fullName(signup)}</p>
          <p className="truncate text-sm text-muted-foreground">{signup.email}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="truncate">{signup.jobTitle} · {signup.companyName}</span>
            <span className="inline-flex items-center gap-1.5"><CountryFlag code={signup.country} className="h-3 w-4" />{countryLabel(signup.country)}</span>
            <span>Requested {relativeTime(signup.createdAt)}</span>
          </p>
          {signup.useCase && <p tabIndex={0} title={signup.useCase} className="mt-2 line-clamp-2 border-l-2 border-primary/30 pl-2.5 text-sm text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{signup.useCase}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:justify-end">
        <Button variant="outline" size="sm" onClick={() => onDecide("reject")}><X />Reject</Button>
        <Button size="sm" onClick={() => onDecide("approve")}><Check />Approve</Button>
      </div>
    </li>
  )
}

// Widths rotate so the placeholder rows don't look stamped
const SKELETON_WIDTHS = [["w-40", "w-56", "w-64"], ["w-32", "w-48", "w-52"], ["w-48", "w-60", "w-44"]]

/** One page of placeholder rows shaped like SignupRow; the card clips and fades what doesn't fit. */
function LoadingRows() {
  return (
    <ul aria-hidden className="divide-y">
      {Array.from({ length: PAGE_SIZE }, (_, index) => {
        const [name, email, meta] = SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]
        return (
          // Phones have no fixed-height card: 6 rows are enough there
          <li key={index} className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4", index >= 6 && "hidden md:flex")}>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                <Skeleton className={cn("h-3.5 max-w-full", name)} />
                <Skeleton className={cn("h-3.5 max-w-full", email)} />
                <Skeleton className={cn("mt-3 h-3 max-w-full", meta)} />
              </div>
            </div>
            <div className="flex shrink-0 gap-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /></div>
          </li>
        )
      })}
    </ul>
  )
}

export function SignupsPage() {
  const { status, signups, error, refreshing, total, nextCursor, loadingMore, moreError } = usePendingSignups()
  const skeleton = status === "idle" || status === "loading"
  const [decision, setDecision] = useState<Decision | null>(null)
  // The URL holds the applied search so a reload or shared link keeps it
  const [params, setParams] = useSearchParams()
  const query = params.get("q") ?? ""
  const [search, setSearch] = useState(query)
  const sentinel = useRef<HTMLLIElement>(null)
  // The rows scroll inside the card (md and up), so paging watches this box, not the window
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadPendingSignups(query)
    scroller.current?.scrollTo({ top: 0 })
  }, [query])

  // Debounce typing before it becomes the applied query
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim()
      if (next !== query) setParams(next ? { q: next } : {}, { replace: true })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, query, setParams])

  // Infinite scroll: fetch the next page as the end of the list nears the viewport
  useEffect(() => {
    const node = sentinel.current
    if (!node || !nextCursor) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMoreSignups()
    }, {
      // md and up the rows scroll inside the card; on phones the page scrolls (a non-scrolling root would always intersect)
      root: window.matchMedia("(min-width: 48rem)").matches ? scroller.current : null,
      rootMargin: "240px",
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [nextCursor])

  function clearSearch() {
    setSearch("")
    setParams({}, { replace: true })
  }

  // Resolves true to close the dialog, false to keep it open for a retry
  async function decide(kind: Decision["kind"], signup: SessionUser, reason = ""): Promise<boolean> {
    try {
      if (kind === "approve") {
        await signupsApi.approve(signup.id)
        toast.success(`Approved ${signup.firstName}`, { description: "They've been emailed and can sign in now." })
      } else {
        await signupsApi.reject(signup.id, reason || undefined)
        toast.success(`Rejected ${signup.firstName}`, { description: `We've emailed ${signup.email} to let them know.` })
      }
      removePendingSignup(signup.id)
      return true
    } catch (caught) {
      // Another admin got there first: the request is no longer pending
      if (errorCode(caught) === "SIGNUP_NOT_FOUND") {
        removePendingSignup(signup.id)
        toast.info("Already handled", { description: `${fullName(signup)}'s request was reviewed by someone else.` })
        return true
      }
      toast.error(kind === "approve" ? "Couldn't approve" : "Couldn't reject", { description: authErrorMessage(caught) })
      return false
    }
  }

  return (
    <AppShell breadcrumb={["Admin", "Signup Requests"]}>
      {/* md and up: fills the screen under the sticky header (h-16 / lg:72px + 1px border); only the rows scroll */}
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8 md:max-h-[calc(100dvh-4rem-1px)] lg:max-h-[calc(100dvh-72px-1px)]">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Signup Requests</h1>
            <p className="text-sm text-muted-foreground">People who signed up with a personal email address. Approving lets them sign in, and we'll email them.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadPendingSignups(query)} disabled={refreshing || status === "loading"}><RefreshCw className={refreshing ? "animate-spin" : undefined} />Refresh</Button>
        </div>

        <Card className="min-h-0 gap-0 overflow-hidden p-0">
          <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium">
              {query ? "Search results" : "Waiting for review"}
              {status === "ready" && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">{total} {query ? (total === 1 ? "match" : "matches") : "waiting"}</span>}
            </span>
            <div className="relative sm:w-72">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search sign-up requests" placeholder="Search by name or email" maxLength={100} className="h-9 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
          {/* As tall as its rows; capped by main on md+, then only the rows scroll. While loading, the skeleton is clipped with a fade */}
          <div ref={scroller} className={cn("min-h-0 overscroll-contain", skeleton ? "overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]" : "overflow-y-auto")}>
          {skeleton ? (
            <LoadingRows />
          ) : status === "error" ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertCircle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadPendingSignups(query)}>Try again</Button>
            </div>
          ) : signups.length === 0 && query ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><Search className="size-5" /></span>
              <p className="text-sm font-medium">No pending sign-ups match “{query}”</p>
              <Button variant="outline" size="sm" className="mt-1" onClick={clearSearch}>Clear search</Button>
            </div>
          ) : signups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><Inbox className="size-5" /></span>
              <p className="text-sm font-medium">No sign-ups waiting for review</p>
              <p className="text-sm text-muted-foreground">New requests from personal email addresses will show up here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {signups.map((signup) => <SignupRow key={signup.id} signup={signup} onDecide={(kind) => setDecision({ kind, signup })} />)}
              <li ref={sentinel} className="px-4 py-3 text-center text-xs text-muted-foreground">
                {moreError
                  ? <span className="inline-flex items-center gap-2 text-destructive">Couldn't load more. <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void loadMoreSignups()}>Try again</Button></span>
                  : loadingMore || nextCursor
                    ? <span className="inline-flex items-center gap-2"><Loader2 aria-hidden className="size-3.5 animate-spin" />Loading more…</span>
                    : "That's everyone"}
              </li>
            </ul>
          )}
          </div>
        </Card>
      </main>

      <ApproveDialog
        open={decision?.kind === "approve"}
        onOpenChange={(open) => !open && setDecision(null)}
        title="Approve this request?"
        description={decision && <>They'll be able to sign in as a customer straight away. We'll email <span className="font-medium text-foreground">{decision.signup.email}</span> to let them know.</>}
        onConfirm={() => (decision ? decide("approve", decision.signup) : true)}
      />
      <ReasonDialog
        open={decision?.kind === "reject"}
        onOpenChange={(open) => !open && setDecision(null)}
        tone="destructive"
        icon={UserX}
        title="Reject this request?"
        description={decision && <><span className="font-medium text-foreground">{fullName(decision.signup)}</span> won't be able to sign in. We'll email them to let them know, including your note if you add one.</>}
        confirmLabel="Reject"
        field={{ label: "Note to the person", placeholder: "e.g. Please sign up again with your company email address.", maxLength: 500 }}
        onConfirm={(reason) => (decision ? decide("reject", decision.signup, reason) : true)}
      />
    </AppShell>
  )
}
