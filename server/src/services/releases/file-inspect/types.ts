export type FileFormat = "PE" | "DEB" | "PKG" | "PDF" | "OTHER";

export type VersionSource = "name" | "pe" | "deb" | "pkg" | "pdf";

/** One version the file claims, and where it says so. */
export interface FoundVersion {
  source: VersionSource;
  /** e.g. "ProductVersion", "Version:", "pkg-info version", "Info Subject". */
  field: string;
  /** The value as written, e.g. "1.135.0-1792088006". */
  raw: string;
  /** Normalised "x.y.z". */
  version: string;
}
