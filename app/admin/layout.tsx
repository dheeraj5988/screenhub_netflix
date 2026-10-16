import type React from "react"
import type { Metadata, Viewport } from "next"

// Lets the admin panel be added to the phone home screen as its own app.
export const metadata: Metadata = {
  title: "ScreenHub Admin",
  manifest: "/admin.webmanifest",
  appleWebApp: { capable: true, title: "ScreenHub Admin", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#141414",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
