import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { unsubscribeToken, unsubscribeUrl } from "@/lib/email/unsubscribe";

// The page an email's "Unsubscribe" link opens (ADR 0053). It works with no sign-in: the link's token is the proof. It
// changes nothing by itself (a mail scanner opening the link must not unsubscribe anyone): its button POSTs to the one-click
// route. It never shows an address, a name or a team. Not cached, not indexed, and the address (which holds the token) is
// not passed on as a referrer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe from email", robots: { index: false, follow: false }, referrer: "no-referrer" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  // Only the token's shape is checked here: whether it matches anyone is never shown, so this page cannot be used to test tokens.
  const token = unsubscribeToken(one(q.t));
  const action = token ? unsubscribeUrl("", token) : null;
  return (
    <section aria-labelledby="unsub" className="max-w-prose">
      <h1 id="unsub" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Unsubscribe</h1>
      {action ? (
        <form method="post" action={action} className="mt-4 flex max-w-sm flex-col gap-3">
          <p className="text-[15px] text-ink">Stop these emails? You can turn them back on any time from your account page.</p>
          <input type="hidden" name="List-Unsubscribe" value="One-Click" />
          <div>
            <Button type="submit">Stop these emails</Button>
          </div>
        </form>
      ) : (
        <p role="status" className="mt-4 max-w-sm text-[15px] text-ink">
          This unsubscribe link did not work. Sign in and turn email alerts off on your account page.
        </p>
      )}
    </section>
  );
}
