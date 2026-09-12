import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "PR Review Assistant",
  description: "AI-powered PR review assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
