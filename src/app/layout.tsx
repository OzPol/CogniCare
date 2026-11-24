import type { Metadata, Viewport } from "next";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "CogniCare",
  description: "Gentle cognitive activities and everyday reminders.",
  applicationName: "CogniCare",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-32.png", apple: "/icon-180.png" },
  appleWebApp: { capable: true, title: "CogniCare", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#f7f8f0", colorScheme: "light", viewportFit: "cover" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
