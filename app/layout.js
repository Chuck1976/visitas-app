import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Visitas Pro App",
  description: "Agenda privada de visitas comerciales",
  manifest: "/manifest.json",
  icons: {
    icon: "/visitas-pro-icon-192.png",
    apple: "/visitas-pro-icon-192.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1.5,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
