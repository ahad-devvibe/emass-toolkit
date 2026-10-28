import { createContext } from "react"
import type { UploadsStore } from "./uploads.store"

/** The tab's one uploads store; UploadsProvider owns it. */
export const UploadsContext = createContext<UploadsStore | null>(null)
