import { useEffect, useState, type ReactNode } from "react";
import { Layers, Menu, Plus, UserCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { roleLabels, type SessionUser } from "@/auth/auth.types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { canCreateRelease } from "@/pages/Releases/release-permissions";
import { useReleaseCounts } from "@/pages/Releases/useReleaseQueries";
import {
  loadBadgeTotal,
  usePendingSignups,
} from "@/pages/Signups/pendingSignups.store";
import { cn } from "@/lib/utils";
import { AppHeader, Breadcrumb } from "./AppHeader";
import { BrandLogo } from "./BrandLogo";
import { UserAvatar } from "./UserAvatar";

// Navy sidebar items (Figma reference): bold white labels, active pill in #0D72B9 with a white bar
const navItem =
  "relative flex h-12 items-center gap-3 rounded-[14px] px-3.5 text-[15px] whitespace-nowrap font-bold text-sidebar-foreground/85 transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-white/40";
const navIdle = "hover:bg-white/10 hover:text-sidebar-foreground";
const navActive =
  "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)] before:absolute before:inset-y-3 before:-left-3 before:w-1 before:rounded-full before:bg-white";

type NavEntry = {
  to: string;
  label: string;
  Icon: typeof Layers;
  active: boolean;
  count?: number;
};

function useNavEntries(user: SessionUser): NavEntry[] {
  const { pathname } = useLocation();
  const isAdmin = user.role === "ADMIN";
  // Server counts, refetched on every route change; only admins need them
  const pending = useReleaseCounts(isAdmin)?.in_review ?? 0;
  const { badgeTotal } = usePendingSignups();

  // Load the sign-up queue once per admin session so the badge is accurate on any page
  useEffect(() => {
    if (isAdmin && badgeTotal === null) void loadBadgeTotal();
  }, [isAdmin, badgeTotal]);

  return [
    {
      to: "/releases",
      label: "Releases",
      Icon: Layers,
      active: pathname.startsWith("/releases"),
      // Admins review submissions, so the badge counts what waits for them
      count: isAdmin ? pending : undefined,
    },
    ...(isAdmin
      ? [
          {
            to: "/admin/signups",
            label: "Sign-up requests",
            Icon: UserCheck,
            active: pathname.startsWith("/admin/signups"),
            count: badgeTotal ?? 0,
          },
        ]
      : []),
  ];
}

function NavLinks({
  entries,
  onNavigate,
}: {
  entries: NavEntry[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="space-y-2 px-4 py-6">
      {entries.map(({ to, label, Icon, active, count }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(navItem, active ? navActive : navIdle)}
        >
          <Icon className="size-[18px] shrink-0" strokeWidth={2.25} />
          <span className="min-w-0 truncate">{label}</span>
          {count ? (
            <span className="ml-auto min-w-6 shrink-0 rounded-full bg-white px-2 py-0.5 text-center text-[11px] font-bold tabular-nums text-[#0f3678]">
              {count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function UserFooter({ user }: { user: SessionUser }) {
  return (
    <div className="mt-auto border-t border-sidebar-border p-5">
      <div className="flex items-center gap-3">
        <UserAvatar user={user} className="size-10 ring-2 ring-white/15" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/65">
            {roleLabels[user.role]} · {user.companyName}
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarBrand() {
  // Logo centred with breathing room above and below
  return (
    <div className="flex shrink-0 items-center justify-center px-8 pt-4 pb-4">
      <BrandLogo to="/releases" tone="light" className="w-[120px]" />
    </div>
  );
}

function Sidebar({
  user,
  entries,
}: {
  user: SessionUser;
  entries: NavEntry[];
}) {
  // Standalone, full height; the top bar starts to its right
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar-navy shadow-[0_4px_8.3px_0_rgba(129,129,165,0.4)] md:flex md:flex-col dark:shadow-none">
      <SidebarBrand />
      <NavLinks entries={entries} />
      <UserFooter user={user} />
    </aside>
  );
}

type StaffShellProps = {
  user: SessionUser;
  isDark: boolean;
  onToggleTheme: () => void;
  breadcrumb?: string[];
  children: ReactNode;
};

export function StaffShell({
  user,
  isDark,
  onToggleTheme,
  breadcrumb = [],
  children,
}: StaffShellProps) {
  const entries = useNavEntries(user);
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const mobileMenu = (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 md:hidden"
            aria-label="Open navigation"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-72 flex-col gap-0 border-0 bg-sidebar-navy p-0 text-sidebar-foreground"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarBrand />
        <NavLinks entries={entries} onNavigate={() => setMenuOpen(false)} />
        <UserFooter user={user} />
      </SheetContent>
    </Sheet>
  );

  const actions =
    canCreateRelease(user.role) && pathname !== "/releases/new" ? (
      <Button render={<Link to="/releases/new" />}>
        <Plus />
        <span className="hidden sm:inline">New release</span>
      </Button>
    ) : null;

  return (
    <>
      <Sidebar user={user} entries={entries} />
      <div className="md:pl-64">
        {/* The sidebar carries the logo on desktop; phones (no sidebar) keep it in the bar */}
        <AppHeader
          user={user}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          leading={mobileMenu}
          actions={actions}
          logoClassName="md:hidden"
        >
          {breadcrumb.length > 0 && <Breadcrumb parts={breadcrumb} />}
        </AppHeader>
        {children}
      </div>
    </>
  );
}
