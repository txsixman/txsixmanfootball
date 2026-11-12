import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanSignIn } from "@/lib/auth/config";
import { LegalH2, LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms", description: "The rules for using this site and having an account." };

// Read per request: with fan accounts off (FAN_SIGNIN) there are no accounts to write about, so no such page.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  if (!fanSignIn()) notFound();
  return (
    <LegalPage id="terms" title="Terms" updated="November 12, 2026">
      <p className="mt-4">
        These are the rules for this site. Reading it needs no account. Making an account, following teams and (as they open)
        posting and reporting scores means you agree to these terms and the{" "}
        <Link href="/privacy" className="text-navy underline hover:no-underline">privacy page</Link>.
      </p>

      <LegalH2>Who can have an account</LegalH2>
      <p className="mt-2">
        You must be 13 or older. You tell us your birth year when you sign up, and we refuse and delete the account of anyone under 13.
        Please give your real birth year. One person, one account. You are responsible for what is done with it.
      </p>

      <LegalH2>Your display name</LegalH2>
      <p className="mt-2">
        It is public. Do not use someone else&apos;s name, a slur, or a name that pretends to be the site or its staff. We may refuse or
        change a name that breaks these rules.
      </p>

      <LegalH2>What you post</LegalH2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Posts, comments and score reports are public, and your display name shows with them.</li>
        <li>They are yours. By posting you let the site show, store and keep the edit history of them for as long as the post or the site exists.</li>
        <li>No slurs, threats, harassment or bullying. No private details about anyone, especially a student: no phone numbers, addresses, or where someone will be.</li>
        <li>No spam, no advertising, and no pictures or files (none can be uploaded). Accounts older than 7 days may post plain links, shown as text only.</li>
        <li>Do not report a score you do not know to be right. A fan-reported score is shown only once two different members, each older than 7 days, agree, or it matches what the site reads itself. Until then no winner is named.</li>
      </ul>

      <LegalH2>Moderation</LegalH2>
      <p className="mt-2">
        Moderation is automatic: a word list blocks slurs and threats; three different members flagging a post hides it; three hidden
        posts in 30 days mutes the account; edits keep their history. The site&apos;s owner may unhide, unmute or ban, and may remove
        anything at any time. Because no one reviews posts first, a post can be seen before it is hidden.
      </p>

      <LegalH2>Scores, ratings and projections</LegalH2>
      <p className="mt-2">
        Ratings, projected margins and win probabilities are estimates, not facts. A score marked unconfirmed may change. Nothing here is an
        official result of any league or school.
      </p>

      <LegalH2>Copyright complaints</LegalH2>
      <p className="mt-2">
        If something posted here is yours and you did not allow it, send a notice (DMCA agent registration pending; send notices to{" "}
        <a href="mailto:contact@txsixmanfootball.com" className="text-navy underline hover:no-underline">contact@txsixmanfootball.com</a>). Say what
        it is, where it is on the site, that you are the owner or act for the owner, and that the notice is true. We remove what is
        properly reported and may close the account of anyone who keeps posting what is not theirs.
      </p>

      <LegalH2>Leaving</LegalH2>
      <p className="mt-2">
        You can delete your account any time on <Link href="/account" className="text-navy underline hover:no-underline">your account page</Link>.
        We may suspend or close an account that breaks these rules.
      </p>

      <LegalH2>No promises</LegalH2>
      <p className="mt-2">
        The site is free and provided as it is. It may be wrong, slow or unavailable, and we are not liable for what comes of using it,
        to the extent the law allows. We may change these terms; the date at the top says when. Texas law applies.
      </p>
    </LegalPage>
  );
}
