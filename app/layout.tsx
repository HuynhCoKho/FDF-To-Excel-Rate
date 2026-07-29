import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "PDF Table Extractor | Huỳnh Cỏ Khô",
    description: "Trích xuất bảng tỷ giá từ PDF sang Excel và tự động quy đổi sang USD ngay trong trình duyệt.",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "PDF Table Extractor",
      description: "Trích xuất bảng tỷ giá PDF thành Excel · Author: Huỳnh Cỏ Khô",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "PDF Table Extractor của Huỳnh Cỏ Khô" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "PDF Table Extractor",
      description: "Trích xuất bảng tỷ giá PDF thành Excel · Author: Huỳnh Cỏ Khô",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
