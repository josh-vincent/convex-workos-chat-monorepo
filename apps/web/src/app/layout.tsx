import type { Metadata } from "next";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { Inter, Montserrat, Lato, Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import { WebAuthProvider } from "./auth-provider";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"] });
const montserrat = Montserrat({ subsets: ["latin"] });
const lato = Lato({ weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chat",
  description: "A cross-platform AI chat starter.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body
        className={cn(inter.className, montserrat.className, lato.className)}
      >
        <AuthKitProvider>
          <WebAuthProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </WebAuthProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
