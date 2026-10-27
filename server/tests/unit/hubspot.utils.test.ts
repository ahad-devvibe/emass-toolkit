import { describe, expect, it } from "vitest";
import {
  downloadLabel,
  firstDownloadNoteBody,
  toDownloadProperties,
} from "../../src/services/hubspot/hubspot.utils.js";

const first = "EMASS Core SDK v1.2.0: emass-mac.dmg";
const last = "EMASS Core SDK v1.4.0: emass-win.zip";

describe("downloadLabel", () => {
  it("reads product, version and file", () => {
    expect(
      downloadLabel({
        productName: "EMASS Core SDK",
        version: "1.4.0",
        fileName: "emass-win.zip",
      }),
    ).toBe(last);
  });
});

describe("toDownloadProperties", () => {
  const counters = {
    downloadCount: 3,
    firstDownloadAt: new Date("2026-10-01T09:00:00.000Z"),
    firstDownloadLabel: first,
    lastDownloadAt: new Date("2026-10-26T10:00:00.000Z"),
    lastDownloadLabel: last,
  };

  it("sets the stored totals, dates and first/last files", () => {
    expect(toDownloadProperties(counters)).toEqual({
      emass_download_count: "3",
      emass_first_download_at: "2026-10-01T09:00:00.000Z",
      emass_last_download_at: "2026-10-26T10:00:00.000Z",
      emass_first_download: first,
      emass_last_download: last,
    });
  });

  it("only sends what's known (e.g. a label lost to a deleted file)", () => {
    expect(
      toDownloadProperties({ ...counters, firstDownloadLabel: null }),
    ).not.toHaveProperty("emass_first_download");
  });
});

describe("firstDownloadNoteBody", () => {
  it("names the first file and the licence acceptance", () => {
    expect(
      firstDownloadNoteBody(first, {
        acceptedAt: new Date("2026-10-26T10:00:00.000Z"),
        version: "2026-10-draft",
      }),
    ).toBe(
      `First download from the EMASS portal: ${first}. Accepted the EMASS Software Licence (2026-10-draft) on 26 Oct 2026.`,
    );
  });

  it("still reads well without a label or licence record", () => {
    expect(
      firstDownloadNoteBody(null, { acceptedAt: null, version: null }),
    ).toBe("First download from the EMASS portal.");
  });
});
