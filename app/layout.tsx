import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { BROWSER_SUPPORT_NOTICE_SCRIPT } from "@/lib/browser-support-notice";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "鉄筋資材算定システム | サプロン建材工業株式会社",
  description: "6mの鉄筋切断計画を最適化する業務用Webアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{ __html: BROWSER_SUPPORT_NOTICE_SCRIPT }}
        />
        <noscript>
          <div
            style={{
              padding: '16px',
              background: '#fef2f2',
              color: '#0f172a',
              fontSize: '14px',
            }}
          >
            本システムのご利用には JavaScript を有効にしてください。
          </div>
        </noscript>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
