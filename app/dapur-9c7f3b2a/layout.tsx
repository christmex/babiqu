import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dapur Babiqu",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
