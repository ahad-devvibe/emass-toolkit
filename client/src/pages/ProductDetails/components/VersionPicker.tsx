import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Release } from "@/pages/Catalog/catalog.types"
import { cn } from "@/lib/utils"
import { shortDate } from "../release.utils"

const LatestTag = () => <span className="rounded bg-success/10 px-1.5 py-px text-[11px] font-medium text-success">Latest</span>

type VersionPickerProps = { releases: Release[]; value: string; onChange: (version: string) => void; className?: string }

/** Searchable version switcher (cmdk in a popover); releases are newest first. */
export function VersionPicker({ releases, value, onChange, className }: VersionPickerProps) {
  const [open, setOpen] = useState(false)
  const latest = releases[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Release version, v${value}`}
        className={cn("flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30", className)}
      >
        <span className="font-mono font-medium">v{value}</span>
        {value === latest?.version && <LatestTag />}
        <ChevronsUpDown aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-(--anchor-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder="Search versions" />
          <CommandList>
            <CommandEmpty>No matching version.</CommandEmpty>
            <CommandGroup>
              {releases.map((release) => (
                // cmdk filters on this string, so "2.3", "v2.3" and "Mar 2026" all match
                <CommandItem key={release.version} value={`${release.version} v${release.version} ${shortDate(release.released)}`} onSelect={() => { onChange(release.version); setOpen(false) }}>
                  <span className="font-mono">v{release.version}</span>
                  {release === latest && <LatestTag />}
                  <span className="ml-auto text-xs text-muted-foreground">{shortDate(release.released)}</span>
                  <Check aria-hidden className={cn("size-4 text-primary", release.version === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
