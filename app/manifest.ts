import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Babiqu Dapur",
    short_name: "Babiqu",
    description: "Admin panel & pemesanan Babiqu",
    start_url: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: "/logo.jpeg", sizes: "192x192", type: "image/jpeg" },
      { src: "/logo.jpeg", sizes: "512x512", type: "image/jpeg" },
    ],
  };
}
