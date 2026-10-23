import { EditRelease } from "./EditRelease"
import { NewRelease } from "./NewRelease"

/**
 * /releases/new asks for product and version and creates the draft on the
 * first drop; /releases/:id/edit uploads into an existing draft.
 */
export function ReleaseEditorPage({ releaseId }: { releaseId?: string }) {
  return releaseId ? <EditRelease releaseId={releaseId} /> : <NewRelease />
}
