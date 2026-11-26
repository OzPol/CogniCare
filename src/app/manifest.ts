import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "CogniCare", short_name: "CogniCare", start_url: "/", scope: "/",
    display: "standalone", lang: "en", background_color: "#f7f8f0", theme_color: "#f7f8f0",
    description: "Gentle cognitive activities and everyday reminders.",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
