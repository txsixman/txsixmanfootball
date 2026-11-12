import Link from "next/link";

/** The privacy and terms links, for the places a person signs up or manages an account. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[14px] text-muted ${className}`}>
      <Link href="/privacy" className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Privacy</Link>
      {" · "}
      <Link href="/terms" className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Terms</Link>
    </p>
  );
}
