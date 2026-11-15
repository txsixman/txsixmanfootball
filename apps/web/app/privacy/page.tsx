import type { Metadata } from "next";
import Link from "next/link";
import { fanSignIn } from "@/lib/auth/config";
import { LegalH2, LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy", description: "What this site keeps about you, and what it never does." };

const A = ({ href, children }: { href: string; children: string }) => (
  <Link href={href} className="text-navy underline hover:no-underline">{children}</Link>
);

// Always public, linked from every page's footer. Read per request (FAN_SIGNIN): with fan accounts off there are no accounts
// to write about, so the account parts are left out; what is left (page counts, push alerts, who gets what) is true either way.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const accounts = fanSignIn();
  return (
    <LegalPage id="privacy" title="Privacy" updated="November 15, 2026">
      <p className="mt-4">
        You can read everything on this site without an account, and without giving us anything.{" "}
        {accounts
          ? "An account is only for following teams and, as they open, posting and reporting scores. This page says exactly what the site keeps."
          : "This page says exactly what the site keeps."}
      </p>

      <LegalH2>{accounts ? "What we keep" : "What the site keeps"}</LegalH2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li><strong>Page counts and load times.</strong> The site counts page views and measures how fast pages load. It uses no cookies for this and keeps no name, email address or other personal detail with it.</li>
        <li>
          <strong>The teams you follow, on this browser.</strong> Which teams you follow is remembered in this browser&apos;s own storage, on your device.
          {accounts ? " If you are signed in, it is also kept on your account (below)." : " It is not sent to us."}
        </li>
        <li>
          <strong>Push alerts.</strong> If you turn on score alerts, your browser&apos;s push address and its two public keys are kept, with the teams you
          follow, to send alerts to that browser. Signed out, it is per browser and holds no name or email. Stop
          alerts on a program page, or block notifications for this site, and it is deleted.
          {accounts ? " Signed in, it is tied to your account instead (see Push alerts on your account, below)." : ""}
        </li>
        {accounts && (
          <>
            <li><strong>Your email address.</strong> Kept in the sign-in system, to send you a sign-in link and to know it is you. It is never shown to anyone. If you turn on email alerts or the weekly digest, it also goes to our email service (see Email alerts, below). If you sign in with Google, Google also tells the sign-in system your name and the address of your profile picture; we do not use or show them.</li>
            <li><strong>A display name.</strong> You pick it. It is public: it shows on anything you post. Please do not use your real name.</li>
            <li><strong>Your birth year.</strong> The year only, never a full date. It is used at sign-up to check that you are 13 or older, and again, only if you try to turn on emails, to check that you are 18 or older by birth year. It is never shown to anyone and never sent to anyone, our email service included. If you are exactly 13 years back, we ask whether you have had your 13th birthday; we use the answer once and do not keep it.</li>
            <li><strong>The teams you follow, on your account.</strong> Kept on your account so My teams is the same on every device.</li>
            <li><strong>What you post.</strong> Forum posts, game comments and score reports, as they open. Posts are public, and the display name goes with them. If you edit one, every earlier version is kept.</li>
            <li><strong>Your email settings.</strong> Which emails you turned on (email alerts, the weekly digest) and for which teams, and a short record of each email we send you (which kind, and which game or week), so none is sent twice. Kept until you turn the email off, and the record until you delete your account.</li>
            <li><strong>Your browsers and devices.</strong> For each browser you are signed in on with alerts: its push address (see Push alerts on your account, below), a short device label such as &ldquo;Chrome on iPhone&rdquo;, when it was linked and when it was last used, and any teams you muted on it. Kept until you remove it, sign out on it or delete your account.</li>
            <li><strong>Your display-name change date.</strong> The date you last changed your display name, so it can be changed once every 30 days.</li>
            <li><strong>A sign-in cookie.</strong> One cookie that keeps you signed in on this browser. It is needed for sign-in and nothing else.</li>
          </>
        )}
      </ul>
      <p className="mt-3">
        We use no advertising or tracking cookies. We keep no real name, age, school, phone number, address or location.
        {accounts ? " No pictures or files can be uploaded. There are no direct messages." : ""} We do not name or rank players.
      </p>

      {accounts && (
        <>
          <LegalH2>You must be 13 or older</LegalH2>
          <p className="mt-2">
            If you tell us you are under 13, your sign-up is stopped and the account is deleted at that moment. Nothing about you is kept.
          </p>

          <LegalH2>Email alerts and the weekly digest</LegalH2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>They are off until you turn them on, on <A href="/account">your account page</A>. You choose which of the teams you follow.</li>
            <li>Your email address goes to our email service only to send the emails you turned on. The service gets the address and the text of the email, nothing else about you.</li>
            <li>They are for accounts 18 or older by birth year. We know only the year, so someone who turns 18 later this year can be included.</li>
            <li>Every email has an Unsubscribe link, and your mail app may show its own one-click Unsubscribe button. One tap turns that kind of email off, with no sign-in.</li>
            <li>We keep your email choices, and a record of each email sent to you, until you delete your account. Turning an email off or unsubscribing stops it; the record of what was already sent stays until the account is deleted.</li>
          </ul>

          <LegalH2>Push alerts on your account</LegalH2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>When you are signed in and follow a team, your browser&apos;s push address is tied to your account, so the teams you follow on your account alert every linked browser. The teams that browser already followed are added to your account.</li>
            <li>At most 5 browsers can be linked to an account. A sixth replaces the one used least recently.</li>
            <li>Signing out on a browser, removing it as a device, or deleting your account removes its push address. If a browser follows teams that did not fit on your account, those few stay on that browser alone. If your sign-in had already expired, the address goes when the browser&apos;s push service reports it gone, or when you delete your account.</li>
          </ul>

          <LegalH2>Your account center</LegalH2>
          <p className="mt-2">On <A href="/account">your account page</A> you can:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>See your linked browsers and devices. Each shows a short device label made from the browser&apos;s name and device, such as &ldquo;Chrome on iPhone&rdquo;. We never keep the browser&apos;s full identifying text. It also shows when the browser was linked and when it was last used. You can remove one, and its alerts stop.</li>
            <li>Mute a team&apos;s push alerts on one browser without unfollowing it.</li>
            <li>Change your display name once every 30 days, and see the date you may change it next.</li>
            <li>Download my data: a file with your display name and dates, your email address and how you sign in, the teams you follow, your devices (label and dates only), your email settings and, as posts open, what you posted. It leaves out your birth year, which is stored and not given back.</li>
            <li>Sign out of all devices. This also removes the push address of every linked browser, and ends your sign-in everywhere.</li>
          </ul>
        </>
      )}

      <LegalH2>Who gets your information</LegalH2>
      <p className="mt-2">
        No one. We do not sell it, rent it, share it or send it to advertisers, data brokers or anyone else. There are no ads on this site. The companies that host the site, count its
        page views{accounts ? ", store its database and send its emails (sign-in links and, only if you turn them on, alerts and the digest)" : " and store its alert list"} handle your information only to do that job for us
        {accounts ? ", and Google only if you choose to sign in with it" : ""}.
      </p>

      {accounts && (
        <>
          <LegalH2>Moderation runs by itself</LegalH2>
          <p className="mt-2">There is no one reading every post. Instead:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Slurs, threats and gambling talk are blocked from a word list before a post is saved.</li>
            <li>Every account has limits on how much it can post a minute, in 10 minutes and in a day. New accounts (under 7 days old) cannot post links and have tighter limits.</li>
            <li>Anyone can report a post. A post that three different members report is hidden automatically.</li>
            <li>An account with three hidden posts in 30 days is muted automatically.</li>
            <li>Edits keep their history, so nothing is changed silently.</li>
            <li>The site&apos;s owner sees reported posts and can hide or unhide a post, and mute, unmute or ban an account, but nothing waits for that.</li>
          </ul>

          <LegalH2>Deleting your account</LegalH2>
          <p className="mt-2">
            You can delete your account yourself, any time, on <A href="/account">your account page</A>. It asks you to confirm, then
            erases your sign-in (your email), display name, follows, linked browsers and their push addresses, email settings and the
            record of emails sent to you, and, as posts open, what you posted (with every earlier version) and the posts you reported. Score
            reports you sent stay, with nothing left that links them to you, so a confirmed score does not change. It cannot be undone. A browser that is not linked to an
            account keeps its own alerts until you stop them with Stop alerts on a program page.
          </p>
        </>
      )}

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
