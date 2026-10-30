import { describe, expect, it } from "vitest"
import { releaseTitle, versionLabel, versionsInName } from "./version.utils"

// The same cases as the server's versionsInText, so both sides read names alike
describe("versionsInName", () => {
  it.each([
    ["emass-core-2.5.0.msi", ["2.5.0"]],
    ["sdk_v1_2_0.exe", ["1.2.0"]],
    ["SDK-V1-2-0.zip", ["1.2.0"]],
    ["emass-1.2.3.4-win.zip", ["1.2.3"]],
    ["sdk-1.3.0-cuda-12.2.0.tar.gz", ["1.3.0", "12.2.0"]],
    ["EMASS-IDE_1.135.0_a08824c_15-10-26_linux-x64.deb", ["1.135.0"]],
    ["EMASS-IDE_User-Guide_v1.4.pdf", ["1.4.0"]],
    ["EMASS IDE Version 1.4", ["1.4.0"]],
    ["emass-1.2.0-and-again-1.2.0.zip", ["1.2.0"]],
  ])("%s -> %j", (name, versions) => {
    expect(versionsInName(name)).toEqual(versions)
  })

  it.each(["emass-sdk-windows.zip", "emass-x86_64-1_2_0.deb", "build-2024.10.01.zip", "build_15-10-26_a08824c.zip", "guide-1.2.pdf", "dev1.4.zip", "v0.0.0.zip"])("%s has no version", (name) => {
    expect(versionsInName(name)).toEqual([])
  })
})

describe("version labels", () => {
  it("names a draft without a version instead of printing vnull", () => {
    expect(versionLabel("1.2.3")).toBe("v1.2.3")
    expect(versionLabel(null)).toBe("No version yet")
    expect(releaseTitle({ product: { name: "EMASS SDK" }, version: "1.2.3" })).toBe("EMASS SDK v1.2.3")
    expect(releaseTitle({ product: { name: "EMASS SDK" }, version: null })).toBe("EMASS SDK (no version yet)")
  })
})
