import "./globals.css";

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
  themeColor: "#165b61",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
