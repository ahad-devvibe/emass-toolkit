import { subscribe as subscribeSession } from "@/auth/session"
import { catalogApi, type License } from "./catalog.api"

// Asked once per session at most: whether this account has accepted the
// download licence (staff always count as accepted). Dropped on sign-out.
let cached: License | null = null
subscribeSession((event) => {
  if (event.type === "signed-out") cached = null
})

export async function loadLicense(): Promise<License> {
  cached ??= await catalogApi.license()
  return cached
}

export function markLicenseAccepted() {
  if (cached) cached = { ...cached, accepted: true }
}

/** After a 409 LICENSE_REQUIRED the cache was wrong; ask again next time. */
export function forgetLicense() {
  cached = null
}
