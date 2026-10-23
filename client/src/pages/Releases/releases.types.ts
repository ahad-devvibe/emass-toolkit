// in_review is the AGENTS.md "staged" state; draft and changes_requested are staff-only.
// The rest of the client model lives in releases.model.ts.
export type ReleaseStatus = "draft" | "in_review" | "changes_requested" | "published" | "archived" | "rolled_back"
