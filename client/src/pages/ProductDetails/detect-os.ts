import type { OperatingSystem } from "@/pages/Catalog/catalog.types"

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } }

export function detectOs(): OperatingSystem | null {
  const platform = ((navigator as NavigatorWithUAData).userAgentData?.platform || navigator.userAgent).toLowerCase()
  // mac before win: "darwin" contains "win"
  if (platform.includes("mac")) return "macos"
  if (platform.includes("win")) return "windows"
  if (platform.includes("linux") && !platform.includes("android")) return "linux"
  return null
}
