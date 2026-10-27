import { toast } from "sonner"
import { authErrorMessage } from "@/auth/auth.messages"

export type DownloadLink = { url: string; fileName: string }

/** Saves a file from a (time-limited) link without opening a tab. */
export function startDownload(url: string, fileName: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.rel = "noopener"
  document.body.append(link)
  link.click()
  link.remove()
}

/** Asks the server for a link (it records the click), then starts the download; toasts either way. */
export async function downloadFromServer(getLink: () => Promise<DownloadLink>): Promise<void> {
  try {
    const { url, fileName } = await getLink()
    startDownload(url, fileName)
    toast.success(`Downloading ${fileName}`)
  } catch (error) {
    toast.error("Couldn't start the download", { description: authErrorMessage(error) })
  }
}
