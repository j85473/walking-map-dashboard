import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Walk Dashboard | Minneapolis",
  description: "Track your walking progress across downtown Minneapolis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
