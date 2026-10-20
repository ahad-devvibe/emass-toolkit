import { Monitor, Package } from "lucide-react"
import type { Product, RecentDownload } from "./catalog.types"

export const products: Product[] = [
  {
    id: "core", name: "EMASS Core SDK", description: "Essential drivers and tools to integrate EMASS devices into your product.", detail: "The foundation for every EMASS integration, with device drivers, discovery tools, and CLI utilities for provisioning and diagnostics.", icon: Monitor, imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
    releases: [
      {
        version: "2.4.0", released: "October 12, 2026", status: "Published",
        files: [
          { kind: "sdk", name: "emass-core-sdk-2.4.0-win-x64.zip", os: "windows", arch: "x64", size: "82 MB", checksum: "1c34074b8bf6cffa6eec581d42792076d69b3e80d31a40c905ead85122df8ef1" },
          { kind: "sdk", name: "emass-core-sdk-2.4.0-macos-universal.zip", os: "macos", arch: "universal", size: "61 MB", checksum: "8a1480e69dda974f7fc5c87c74a9d4f7bc104520e7e156b2c3e0ea89bc0f7d6d" },
          { kind: "sdk", name: "emass-core-sdk-2.4.0-linux-x64.tar.gz", os: "linux", arch: "x64", size: "41 MB", checksum: "f455ddf1bbfb29d6c14377c104154066b592e19677df1531fa815433df30eb4a" },
          { kind: "sdk", name: "emass-core-sdk-2.4.0-linux-arm64.tar.gz", os: "linux", arch: "arm64", size: "39 MB", checksum: "cd2b729f4e0ff01669f50b4a0fb6212be8c73e8856081c83c7d22be55fd87325" },
          { kind: "documentation", name: "emass-core-sdk-2.4.0-api-reference.pdf", title: "API reference", format: "PDF", size: "4.2 MB", checksum: "68fd5fdc4b092e8e199558ea5b25a2da172c1d4765e5877edfc3e3072fdb63cd" },
          { kind: "manual", name: "emass-core-2.4-integration-guide.pdf", title: "Integration guide", format: "PDF", size: "6.8 MB", checksum: "5d33366824d088ebb57683d79aec5b8a0dd018b914a64571c1ac5a61f1f02844" },
          { kind: "manual", name: "emass-core-2.4-hardware-setup.pdf", title: "Hardware setup manual", format: "PDF", size: "3.1 MB", checksum: "b974207b4a560b640b16721a7a68de0bf5f6d59a340b82fb715f7cdee3b6efb7" },
        ],
        releaseNotes: "## Highlights\n\n- **Faster device discovery**: enumeration on USB hubs is up to 3\u00d7 quicker.\n- **Improved USB stability** during long-running sessions.\n- New `emass-cli` tools for provisioning and diagnostics.\n\n## Fixes\n\n- Fixed a reconnect loop when a device was unplugged mid-transfer.\n- Corrected firmware version reporting on macOS.\n\n## Upgrade notes\n\n> Drivers from 2.3.x must be uninstalled before installing 2.4.0 on Windows.\n\n| Component | Version |\n| --- | --- |\n| Device driver | 2.4.0 |\n| Runtime | 1.12.3 |\n",
      },
      {
        version: "2.3.1", released: "September 02, 2026", status: "Archived",
        files: [
          { kind: "sdk", name: "emass-core-sdk-2.3.1-win-x64.zip", os: "windows", arch: "x64", size: "79 MB", checksum: "514469dbfb7d26078541945683f0f3a404786f64803d1cc79a57895e66cee5d0" },
          { kind: "sdk", name: "emass-core-sdk-2.3.1-linux-x64.tar.gz", os: "linux", arch: "x64", size: "39 MB", checksum: "41b33830da1711391901a3c179a03aa72e1af81ff696882a874c2a7a0b6e34ce" },
          { kind: "documentation", name: "emass-core-sdk-2.3.1-api-reference.pdf", title: "API reference", format: "PDF", size: "4.0 MB", checksum: "dc5fbfd3707c88b0f0a9e6a6927e9463596d1e81f724896392172a30349a69b5" },
        ],
        releaseNotes: "## Fixes\n\n- Fixed reconnect behaviour after host sleep.\n- Updated device profiles for EMASS rev. C boards.\n",
      },
      {
        version: "2.2.0", released: "July 14, 2026", status: "Archived",
        files: [
          { kind: "sdk", name: "emass-core-sdk-2.2.0-win-x64.zip", os: "windows", arch: "x64", size: "74 MB", checksum: "6d888d6dea77dbfd21ca5ea41075c1bc2a3ea528292b91460f6b9c2904d583d1" },
          { kind: "sdk", name: "emass-core-sdk-2.2.0-linux-x64.tar.gz", os: "linux", arch: "x64", size: "36 MB", checksum: "debd9e1b6a879d6d36e9646b5a24b3520904ed9ff9ef338bba8d19cb11d2b7c0" },
        ],
      },
    ],
  },
  {
    id: "vision", name: "EMASS Vision SDK", description: "Computer vision libraries and calibrated drivers for EMASS imaging hardware.", detail: "Build vision experiences with calibrated imaging drivers, frame-processing libraries, and tools for validating camera performance across supported platforms.", icon: Package, imageUrl: "https://images.unsplash.com/photo-1535378917042-10a22c95931a?auto=format&fit=crop&w=1200&q=80",
    releases: [
      {
        version: "1.8.2", released: "September 28, 2026", status: "Published",
        files: [
          { kind: "sdk", name: "emass-vision-sdk-1.8.2-win-x64.zip", os: "windows", arch: "x64", size: "126 MB", checksum: "e7f2a9566f96ec2beaba7be17045fb0ed4ccdedab5f5c0599f412ad35118289d" },
          { kind: "sdk", name: "emass-vision-sdk-1.8.2-linux-x64.tar.gz", os: "linux", arch: "x64", size: "121 MB", checksum: "88464930b330343d41269ae1bd25e9c573c3f1a5d2400f679b6fd6a24fdc522a" },
          { kind: "documentation", name: "emass-vision-sdk-1.8.2-api-reference.pdf", title: "API reference", format: "PDF", size: "5.6 MB", checksum: "7fe1b534fe1dbfa6dde508b0a5a3fc3b8756abc9e71e9725c915313bc33ef829" },
          { kind: "manual", name: "emass-vision-1.8-calibration-manual.pdf", title: "Calibration manual", format: "PDF", size: "8.4 MB", checksum: "989c09ab88fbaebdbfeb6565b5ae84ad19a219c646ca422d08b761384086c1a5" },
        ],
        releaseNotes: "## Highlights\n\n- New **calibration utilities** with guided lens profiling.\n- Frame pipeline is ~20% faster on supported GPUs.\n- Added NVIDIA runtime support on Windows and Linux.\n\n## Known issues\n\n- Low-light calibration may need a second pass on very dark scenes.\n",
      },
      {
        version: "1.8.1", released: "September 06, 2026", status: "Archived",
        files: [
          { kind: "sdk", name: "emass-vision-sdk-1.8.1-win-x64.zip", os: "windows", arch: "x64", size: "124 MB", checksum: "060c049d50422c835eeae1cb8561bf35cd0854e1e7a658f98bf99276061095b1" },
          { kind: "sdk", name: "emass-vision-sdk-1.8.1-linux-x64.tar.gz", os: "linux", arch: "x64", size: "119 MB", checksum: "6e2eb259c491d9d6667248fb0ae34d233f0fea8db92530ff065c84aae5ffc9a6" },
        ],
      },
      {
        version: "1.7.0", released: "July 22, 2026", status: "Archived",
        files: [
          { kind: "sdk", name: "emass-vision-sdk-1.7.0-win-x64.zip", os: "windows", arch: "x64", size: "117 MB", checksum: "3c3c893eaaf2e3d594ef5daf17c15a5d327ac087dc5cf6e8ae2fff0200b7eed0" },
        ],
      },
    ],
  },
]

export const recentDownloads: RecentDownload[] = [{ name: "EMASS Core SDK", version: "v2.4.0", date: "Today, 10:42 AM" }, { name: "EMASS Vision SDK", version: "v1.8.1", date: "October 04, 2026" }]
