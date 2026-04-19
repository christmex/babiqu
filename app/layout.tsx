import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "./sw-register";

export const metadata: Metadata = {
  title: "Babiqu — Pesan Sekarang",
  description: "Signature Roast Pork Delivery — Pesan langsung via WhatsApp",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Babiqu",
  },
};

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
