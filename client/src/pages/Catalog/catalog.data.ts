import { Monitor, Package } from "lucide-react"
import type { Product, RecentDownload } from "./catalog.types"

export const products: Product[] = [
  {
    id: "core", name: "EMASS Core SDK", description: "Essential drivers and tools to integrate EMASS devices into your product.", detail: "The foundation for every EMASS integration, with device drivers, discovery tools, and CLI utilities for provisioning and diagnostics.", icon: Monitor, imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
    releases: [
      { version: "2.4.0", released: "October 12, 2026", status: "Published", notes: ["Updated device discovery", "Improved USB stability", "Includes CLI tools"], files: [{ name: "emass-core-sdk-2.4.0-win-x64.zip", size: "82 MB", platform: "Windows", checksum: "1c34074b8bf6cffa6eec581d42792076d69b3e80d31a40c905ead85122df8ef1" }, { name: "emass-core-sdk-2.4.0-macos-universal.zip", size: "61 MB", platform: "macOS", checksum: "8a1480e69dda974f7fc5c87c74a9d4f7bc104520e7e156b2c3e0ea89bc0f7d6d" }, { name: "emass-core-sdk-2.4.0-linux-x64.tar.gz", size: "41 MB", platform: "Linux", checksum: "f455ddf1bbfb29d6c14377c104154066b592e19677df1531fa815433df30eb4a" }], command: "npm install @emass/core-sdk@2.4.0" },
      { version: "2.3.1", released: "September 02, 2026", status: "Archived", notes: ["Fixed reconnect behavior", "Updated device profiles"], files: [{ name: "emass-core-sdk-2.3.1-win-x64.zip", size: "79 MB", platform: "Windows", checksum: "514469dbfb7d26078541945683f0f3a404786f64803d1cc79a57895e66cee5d0" }, { name: "emass-core-sdk-2.3.1-linux-x64.tar.gz", size: "39 MB", platform: "Linux", checksum: "41b33830da1711391901a3c179a03aa72e1af81ff696882a874c2a7a0b6e34ce" }], command: "npm install @emass/core-sdk@2.3.1" },
      { version: "2.2.0", released: "July 14, 2026", status: "Archived", notes: ["Added Linux support", "Introduced device diagnostics"], files: [{ name: "emass-core-sdk-2.2.0-win-x64.zip", size: "74 MB", platform: "Windows", checksum: "6d888d6dea77dbfd21ca5ea41075c1bc2a3ea528292b91460f6b9c2904d583d1" }, { name: "emass-core-sdk-2.2.0-linux-x64.tar.gz", size: "36 MB", platform: "Linux", checksum: "debd9e1b6a879d6d36e9646b5a24b3520904ed9ff9ef338bba8d19cb11d2b7c0" }], command: "npm install @emass/core-sdk@2.2.0" },
    ],
  },
  {
    id: "vision", name: "EMASS Vision SDK", description: "Computer vision libraries and calibrated drivers for EMASS imaging hardware.", detail: "Build vision experiences with calibrated imaging drivers, frame-processing libraries, and tools for validating camera performance across supported platforms.", icon: Package, imageUrl: "https://images.unsplash.com/photo-1535378917042-10a22c95931a?auto=format&fit=crop&w=1200&q=80",
    releases: [
      { version: "1.8.2", released: "September 28, 2026", status: "Published", notes: ["New calibration utilities", "Faster frame pipeline", "NVIDIA runtime support"], files: [{ name: "emass-vision-sdk-1.8.2-win-x64.zip", size: "126 MB", platform: "Windows", checksum: "e7f2a9566f96ec2beaba7be17045fb0ed4ccdedab5f5c0599f412ad35118289d" }, { name: "emass-vision-sdk-1.8.2-linux-x64.tar.gz", size: "121 MB", platform: "Linux", checksum: "88464930b330343d41269ae1bd25e9c573c3f1a5d2400f679b6fd6a24fdc522a" }], command: "npm install @emass/vision-sdk@1.8.2" },
      { version: "1.8.1", released: "September 06, 2026", status: "Archived", notes: ["Improved low-light calibration", "Stability fixes for long captures"], files: [{ name: "emass-vision-sdk-1.8.1-win-x64.zip", size: "124 MB", platform: "Windows", checksum: "060c049d50422c835eeae1cb8561bf35cd0854e1e7a658f98bf99276061095b1" }, { name: "emass-vision-sdk-1.8.1-linux-x64.tar.gz", size: "119 MB", platform: "Linux", checksum: "6e2eb259c491d9d6667248fb0ae34d233f0fea8db92530ff065c84aae5ffc9a6" }], command: "npm install @emass/vision-sdk@1.8.1" },
      { version: "1.7.0", released: "July 22, 2026", status: "Archived", notes: ["Added calibration workflow", "Introduced accelerated frame processing"], files: [{ name: "emass-vision-sdk-1.7.0-win-x64.zip", size: "117 MB", platform: "Windows", checksum: "3c3c893eaaf2e3d594ef5daf17c15a5d327ac087dc5cf6e8ae2fff0200b7eed0" }], command: "npm install @emass/vision-sdk@1.7.0" },
    ],
  },
]

export const recentDownloads: RecentDownload[] = [{ name: "EMASS Core SDK", version: "v2.4.0", date: "Today, 10:42 AM" }, { name: "EMASS Vision SDK", version: "v1.8.1", date: "October 04, 2026" }]
