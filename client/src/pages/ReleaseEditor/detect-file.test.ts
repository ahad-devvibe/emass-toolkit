import { describe, expect, it } from "vitest"
import { detectMapping } from "./detect-file"

describe("detectMapping", () => {
  it("detects SDK platforms by extension", () => {
    expect(detectMapping("emass-core-2.5.0.msi")).toEqual({ kind: "sdk", os: "windows" })
    expect(detectMapping("emass-core-2.5.0.exe")).toEqual({ kind: "sdk", os: "windows" })
    expect(detectMapping("EMASS Core.dmg")).toEqual({ kind: "sdk", os: "macos" })
    expect(detectMapping("emass-core_2.5.0_amd64.deb")).toEqual({ kind: "sdk", os: "linux" })
    expect(detectMapping("emass.AppImage")).toEqual({ kind: "sdk", os: "linux" })
  })

  it("detects SDK platforms by name tokens", () => {
    expect(detectMapping("emass-core-2.5.0-win64.zip")).toEqual({ kind: "sdk", os: "windows" })
    expect(detectMapping("emass-core-2.5.0-macos-arm64.zip")).toEqual({ kind: "sdk", os: "macos" })
    expect(detectMapping("emass-core-2.5.0-ubuntu.tar.gz")).toEqual({ kind: "sdk", os: "linux" })
  })

  it("never returns an architecture or a doc title", () => {
    expect(detectMapping("emass-linux-arm64.tar.gz")).toEqual({ kind: "sdk", os: "linux" })
    expect(detectMapping("emass-core-2.5-hardware-setup.pdf")).toEqual({ kind: "documentation" })
  })

  it("detects docs by extension or tokens", () => {
    expect(detectMapping("release-notes.md")).toEqual({ kind: "documentation" })
    expect(detectMapping("api-reference.zip")).toEqual({ kind: "documentation" })
  })

  it("leaves unknown files for the uploader to map", () => {
    expect(detectMapping("emass-core-2.5.0.zip")).toEqual({ kind: null })
    expect(detectMapping("blob")).toEqual({ kind: null })
  })
})
