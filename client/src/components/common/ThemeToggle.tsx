import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return <Button size="icon" variant="ghost" aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} onClick={onToggle}>{isDark ? <Sun /> : <Moon />}</Button>
}
