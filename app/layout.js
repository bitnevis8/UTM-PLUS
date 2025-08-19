import { Vazirmatn, Geist_Mono } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  variable: "--font-geist-sans",
  subsets: ["arabic"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "26040130301530120084015030120081040",
  description: "",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body
        className={`${vazirmatn.variable} ${geistMono.variable} antialiased font-sans`}
      >
        <header className="border-b bg-gradient-to-r from-teal-300 via-cyan-400 to-teal-500">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-center">
            <span className="text-white/40 font-semibold text-sm sm:text-base ">
            26040130301530120084015030120081040
            </span>
          </div>
        </header>
        <main className="min-h-[70vh]">{children}</main>
        <footer className="border-b bg-gradient-to-r from-teal-400 via-cyan-500 to-teal-600">
          <div className=" mx-auto px-4 py-3  text-white flex justify-center ">
            <a href="https://pourdian.com" target="_blank" rel="noopener noreferrer">Powered By Pourdian.com</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
