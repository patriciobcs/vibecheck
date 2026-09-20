import "./globals.css";
import Link from "next/link";

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <nav>
        <strong>VibeCheck</strong>
        <Link href="/">Products</Link>
        <Link href="/operations">Operations</Link>
      </nav>
      {children}
    </>
  );
}
