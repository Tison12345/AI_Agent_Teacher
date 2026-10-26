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
      <body className="min-h-full text-fg">
        <a
          href="#main"
          className="sr-only rounded-lg bg-card px-3 py-2 font-medium text-link focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-30"
        >
          Skip to main content
        </a>
        <SiteNav />
        <div className="lg:pl-64">
          <main id="main" className="mx-auto w-full max-w-6xl break-words px-4 py-8 sm:px-8 lg:py-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
