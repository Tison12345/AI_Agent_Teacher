import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Human–AI Co-Learning Agent",
  description:
    "Evaluate weekly student project progress from GitHub changes, with teacher review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <a
          href="#main"
          className="sr-only rounded bg-white px-3 py-2 font-medium text-indigo-700 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10"
        >
          Skip to main content
        </a>
        <SiteNav />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 break-words px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
