import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { countryItems } from "@/lib/countries/countries"
import { useFlags, type FlagMap } from "@/lib/countries/flags"
import { cn } from "@/lib/utils"

// cmdk filters on this string, so "sg", "Singapore" and "singa" all match
const searchValue = (item: { value: string; label: string }) => `${item.label} ${item.value}`

// Presentational flag: the map is loaded once by the combobox, so the 249 rows don't each subscribe
const Flag = memo(function Flag({ code, flags }: { code: string; flags: FlagMap | null }) {
  const Svg = flags?.[code]
  return <span aria-hidden className="inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] bg-muted ring-1 ring-foreground/10">{Svg && <Svg className="size-full" />}</span>
})

type CountryComboboxProps = { id: string; value: string; onChange: (code: string) => void; invalid?: boolean; describedBy?: string }

/** Searchable country picker (cmdk in a popover) with flags; values are ISO alpha-2 codes. */
export function CountryCombobox({ id, value, onChange, invalid, describedBy }: CountryComboboxProps) {
  const [open, setOpen] = useState(false)
  // Starts loading the flag chunk as soon as the form mounts, not on first open
  const flags = useFlags()
  const selected = countryItems.find((item) => item.value === value)
  // The parent passes a new callback each render; keep the latest without rebuilding the rows
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // Rows only change when the flags arrive or the selection changes, not on every keystroke
  const rows = useMemo(
    () =>
      countryItems.map((item) => (
        <CommandItem key={item.value} value={searchValue(item)} onSelect={() => { onChangeRef.current(item.value); setOpen(false) }}>
          <Flag code={item.value} flags={flags} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="font-mono text-xs text-muted-foreground">{item.value}</span>
          <Check aria-hidden className={cn("size-4 text-primary", item.value === value ? "opacity-100" : "opacity-0")} />
        </CommandItem>
      )),
    [flags, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-input bg-transparent px-3 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50"
      >
        {selected
          ? <><Flag code={selected.value} flags={flags} /><span className="truncate">{selected.label}</span></>
          : <span className="truncate text-muted-foreground">Select your country</span>}
        <ChevronsUpDown aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-0 max-w-[calc(100vw-2rem)] p-0">
        <Command defaultValue={selected ? searchValue(selected) : undefined}>
          <CommandInput placeholder="Search country or code…" />
          <CommandList>
            <CommandEmpty>No country matches that search.</CommandEmpty>
            <CommandGroup>{rows}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
