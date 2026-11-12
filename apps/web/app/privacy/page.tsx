import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanSignIn } from "@/lib/auth/config";
import { LegalH2, LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy | Project 80x40", description: "What this site keeps about you, and what it never does." };

const A = ({ href, children }: { href: string; children: string }) => (
  <Link href={href} className="text-navy underline hover:no-underline">{children}</Link>
);

// Read per request: with fan accounts off (FAN_SIGNIN) there are no accounts to write about, so no such page.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  if (!fanSignIn()) notFound();
  return (
    <LegalPage id="privacy" title="Privacy" updated="November 12, 2026">
      <p className="mt-4">
        You can read everything on this site without an account, and without giving us anything. An account is only for
        following teams and, as they open, posting and reporting scores. This page says exactly what an account keeps.
      </p>

      <LegalH2>What we keep</LegalH2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li><strong>Your email address.</strong> Kept in the sign-in system only, to send you a sign-in link and to know it is you. It is never shown to anyone. If you sign in with Google, Google also tells the sign-in system your name and the address of your profile picture; we do not use or show them.</li>
        <li><strong>A display name.</strong> You pick it. It is public: it shows on anything you post. Please do not use your real name.</li>
        <li><strong>Your birth year.</strong> The year only, never a full date. It is used once, to check that you are 13 or older. It is never shown to anyone and never sent to anyone. If you are exactly 13 years back, we ask whether you have had your 13th birthday; we use the answer once and do not keep it.</li>
        <li><strong>The teams you follow.</strong> Kept on your account so My teams is the same on every device.</li>
        <li><strong>What you post.</strong> Forum posts, game comments and score reports, as they open. Posts are public, and the display name goes with them. If you edit one, every earlier version is kept.</li>
        <li><strong>Push alerts.</strong> If you turn on score alerts, your browser&apos;s push address and its two public keys are kept, with the teams you follow, to send alerts to that browser. It is per browser, not part of your account, and holds no name or email. Stop alerts on a program page, or block notifications for this site, and it is deleted.</li>
        <li><strong>A sign-in cookie.</strong> One cookie that keeps you signed in on this browser. It is needed for sign-in and nothing else. We use no advertising or tracking cookies.</li>
      </ul>
      <p className="mt-3">
        We keep no real name, age, school, phone number, address or location. No pictures or files can be uploaded. There are
        no direct messages. We do not name or rank players.
      </p>

      <LegalH2>You must be 13 or older</LegalH2>
      <p className="mt-2">
        If you tell us you are under 13, your sign-up is stopped and the account is deleted at that moment. Nothing about you is kept.
      </p>

      <LegalH2>Who gets your information</LegalH2>
      <p className="mt-2">
        No one. We do not sell it, rent it, share it or send it to advertisers, data brokers or anyone else, and nothing about
        a member under 18 goes to any third party. There are no ads on this site. The companies that host the site, store its
        database and send sign-in emails handle your information only to do that job for us, and Google only if you choose
        to sign in with it. The site also counts page views without cookies or personal details.
      </p>

      <LegalH2>Moderation runs by itself</LegalH2>
      <p className="mt-2">There is no one reading every post. Instead:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Slurs and threats are blocked from a word list before a post is saved.</li>
        <li>New accounts (under 7 days old) cannot post links and have tighter limits on how much they can post.</li>
        <li>A post that three different members flag is hidden automatically.</li>
        <li>An account with three hidden posts in 30 days is muted automatically.</li>
        <li>Edits keep their history, so nothing is changed silently.</li>
        <li>The site&apos;s owner can unhide a post, unmute an account or ban one, but nothing waits for that.</li>
      </ul>

      <LegalH2>Deleting your account</LegalH2>
      <p className="mt-2">
        You can delete your account yourself, any time, on <A href="/account">your account page</A>. It asks you to confirm, then
        erases your sign-in (your email), display name, follows and, as posts open, what you posted. It cannot be undone. Push
        alerts are per browser: stop them with Stop alerts on a program page.
      </p>

      <LegalH2>Questions and takedown requests</LegalH2>
      <p className="mt-2">
        Privacy questions: <a href="mailto:contact@txsixmanfootball.com" className="text-navy underline hover:no-underline">contact@txsixmanfootball.com</a>.
        Copyright complaints: DMCA agent registration pending; send notices to{" "}
        <a href="mailto:contact@txsixmanfootball.com" className="text-navy underline hover:no-underline">contact@txsixmanfootball.com</a>.
        The <A href="/terms">terms</A> explain what to send.
      </p>
      <p className="mt-6 text-[13px] text-muted">We will change this page if what we keep changes, and say so at the top.</p>
    </LegalPage>
  );
}
