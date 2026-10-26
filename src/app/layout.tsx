import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen · Monitoramento",
  description: "Painel de monitoramento da API Lumen",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
