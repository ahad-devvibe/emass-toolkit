import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CountryFlag } from "@/components/common/CountryFlag"
import { countryItems } from "@/lib/countries/countries"

// cmdk filters on this string, so "sg", "Singapore" and "singa" all match
const searchValue = (item: { value: string; label: string }) => `${item.label} ${item.value}`

type CountryComboboxProps = { id: string; value: string; onChange: (code: string) => void; invalid?: boolean; describedBy?: string }

/** Searchable country picker (cmdk in a popover) with flags; values are ISO alpha-2 codes. */
export function CountryCombobox({ id, value, onChange, invalid, describedBy }: CountryComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = countryItems.find((item) => item.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50"
      >
        {selected
          ? <><CountryFlag code={selected.value} /><span className="truncate">{selected.label}</span></>
          : <span className="text-muted-foreground">Select your country</span>}
        <ChevronsUpDown aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-64 p-0">
        <Command defaultValue={selected ? searchValue(selected) : undefined}>
          <CommandInput placeholder="Search country or code…" />
          <CommandList>
            <CommandEmpty>No country matches that search.</CommandEmpty>
            <CommandGroup>
              {countryItems.map((item) => (
                <CommandItem key={item.value} value={searchValue(item)} onSelect={() => { onChange(item.value); setOpen(false) }}>
                  <CountryFlag code={item.value} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.value}</span>
                  <Check aria-hidden className={cn("size-4 text-primary", item.value === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
