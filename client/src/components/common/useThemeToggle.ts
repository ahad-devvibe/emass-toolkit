import { useState } from "react"

function readSavedTheme() {
  let isDark = false
  try {
    isDark = localStorage.getItem("emass-theme") === "dark"
  } catch {
    // Storage unavailable: fall back to light
  }
  document.documentElement.classList.toggle("dark", isDark)
  return isDark
}

export function useThemeToggle() {
  const [isDark, setIsDark] = useState(readSavedTheme)

  function toggleTheme() {
    const nextIsDark = !isDark
    document.documentElement.classList.toggle("dark", nextIsDark)
    try {
      localStorage.setItem("emass-theme", nextIsDark ? "dark" : "light")
    } catch {
      // Preference just won't persist
    }
    setIsDark(nextIsDark)
  }

  return { isDark, toggleTheme }
}
