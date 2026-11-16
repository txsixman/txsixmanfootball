import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getAccount, isCenterError, listDevices, myActivity, signInProviders, type ActivityItem } from "@/lib/account/center";
import { adminUserId, fanEmailSignIn, fanPosts, fanSignIn, safeNext } from "@/lib/auth/config";
import { getFollows, getProfile } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { LegalLinks } from "../legal-links";
import { AlertsToggle } from "../my-teams/alerts-toggle";
import { BrowserAlerts, DevicesList } from "./browsers";
import { longDate } from "./dates";
import { DeleteAccount } from "./delete-account";
import { EmailAlertsBlock } from "./email-alerts-form";
import { loadEmailState } from "./email-state";
import { ImportFollows } from "./import-follows";
import { ProfileForm } from "./profile-form";
import { SignOutButton } from "./sign-out-button";
import { SignOutEverywhere } from "./sign-out-everywhere";
import { TeamsList } from "./teams-list";

// Your account, the Account Center (ADR 0058): one page, six sections with anchors (#profile, then, while posts are on, #activity, then
// #teams, #alerts, #security and #data). From the md breakpoint a sticky list of the sections sits on the left; on a phone the same links sit
// above the stacked sections. Per request, never cached or indexed. It shows the display name, the date joined, the person's own email
// (only under Sign-in and security, to them) and what they have chosen. The birth year is never read back: no function returns it.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

const SECTIONS = [
  { id: "profile", title: "Profile" },
  { id: "activity", title: "My activity" },
  { id: "teams", title: "My teams" },
  { id: "alerts", title: "Alerts and devices" },
  { id: "security", title: "Sign-in and security" },
  { id: "data", title: "Privacy and data" },
] as const;

function Section({ id, title, children }: { id: (typeof SECTIONS)[number]["id"]; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <h2 id={`${id}-title`} className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">{title}</h2>
      {children}
    </section>
  );
}

const H3 = "mt-5 font-num text-[18px] font-bold uppercase tracking-wide text-navy";

const KIND: Record<ActivityItem["kind"], string> = { comment: "Comment", thread: "Forum thread", reply: "Forum reply", score_report: "Score report" };

const PROVIDER_NAME: Record<string, string> = { google: "Google", email: "Email link" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fanSignIn()) redirect("/"); // fan accounts are off
  const params = await searchParams;
  const found = await getUser();
  if (!found) redirect("/sign-in?next=%2Faccount");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin"); // the admin has no part in fan flows
  const profile = await getProfile(found.supabase);
  if (!profile) redirect("/account/welcome?next=%2Faccount");
  const posts = fanPosts();
  // Each read fails alone, into a short note in its own section: one slow answer never takes the page down.
  const [account, devices, follows, email, activity] = await Promise.all([
    getAccount(found.supabase),
    listDevices(found.supabase),
    getFollows(found.supabase).catch(() => null),
    loadEmailState(found.supabase),
    posts ? myActivity(found.supabase, 20) : Promise.resolve(null),
  ]);
  const welcome = params.welcome !== undefined;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const mine = account && !isCenterError(account) ? account : null;
  const displayName = mine?.displayName ?? profile.displayName;
  const joinedAt = mine?.joinedAt ?? profile.createdAt;

  // How they sign in. The email link is listed when that provider is there and the email sign-in is on (or when it is all they have, so
  // the list is never empty). Their own email is shown here, to them, and nowhere else.
  const providers = signInProviders(found.user);
  const methods = providers.filter((p) => p === "google" || (p === "email" && (fanEmailSignIn() || providers.length === 1))).map((p) => PROVIDER_NAME[p]);

  const sections = SECTIONS.filter((s) => s.id !== "activity" || posts);
  return (
    <div>
      <h1 id="account" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Your account</h1>
      {welcome && (
        <p role="status" className="mt-3 text-[15px] text-ink">
          You are in. Follow teams from any program page.{" "}
          {next !== "/" && next !== "/account" && <Link href={next} className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Back to where you were</Link>}
        </p>
      )}
      <div className="mt-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <nav aria-label="Account sections" className="md:sticky md:top-4 md:self-start">
          <ul className="flex flex-wrap gap-x-5 md:flex-col md:gap-x-0">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline hover:no-underline md:no-underline md:hover:underline">{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 flex max-w-prose flex-col gap-10 md:mt-0">
          <Section id="profile" title="Profile">
            <dl className="mt-3 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
              <dt className="text-muted">Display name</dt>
              <dd className="font-semibold text-ink">{displayName}</dd>
              <dt className="text-muted">Joined</dt>
              <dd className="text-ink">{longDate(joinedAt)}</dd>
            </dl>
            <p className="mt-2 max-w-sm text-[13px] leading-5 text-muted">Your display name is the only thing others can see. Your email is shown only to you, under Sign-in and security.</p>
            <ProfileForm displayName={displayName} nextChangeAt={mine?.nextNameChangeAt ?? null} />
          </Section>

          {posts && (
            <Section id="activity" title="My activity">
              {activity === null || isCenterError(activity) ? (
                <p className="mt-2 max-w-sm text-[14px] text-muted">Your activity is not available right now. Try again in a minute.</p>
              ) : activity.length ? (
                <ul className="mt-2">
                  {activity.map((a) => (
                    <li key={`${a.kind}-${a.id}`} className="border-b border-line py-2">
                      <p className="text-[13px] text-muted">
                        <span className="font-bold uppercase tracking-wider text-red">{KIND[a.kind]}</span> &middot; {longDate(a.createdAt)}
                      </p>
                      <p className="text-[15px] text-ink">
                        {a.href ? <Link href={a.href} className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">{a.excerpt}</Link> : a.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 max-w-sm text-[14px] text-muted">Nothing yet. Your comments, forum posts and score reports will show here.</p>
              )}
            </Section>
          )}

          <Section id="teams" title="My teams">
            {follows === null ? (
              <p className="mt-2 max-w-sm text-[14px] text-muted">Your teams are not available right now. Try again in a minute.</p>
            ) : (
              <TeamsList slugs={follows} email={email.status === "ready" ? { status: "ready", eligible: email.eligible, all: email.all, teams: email.teams } : { status: email.status }} />
            )}
            <ImportFollows />
          </Section>

          <Section id="alerts" title="Alerts and devices">
            <AlertsToggle />
            <h3 className={H3}>This browser</h3>
            <BrowserAlerts />
            <h3 className={H3}>Linked browsers</h3>
            <DevicesList devices={isCenterError(devices) ? null : devices} />
            <EmailAlertsBlock email={email} hasFollows={(follows?.length ?? 0) > 0} />
          </Section>

          <Section id="security" title="Sign-in and security">
            <dl className="mt-3 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
              <dt className="text-muted">You sign in with</dt>
              <dd className="text-ink">{methods.length ? methods.join(", ") : "A link sent to your email"}</dd>
              <dt className="text-muted">Your email</dt>
              <dd className="break-all text-ink">{found.user.email ?? "Not on file"}</dd>
            </dl>
            <p className="mt-2 max-w-sm text-[13px] leading-5 text-muted">Only you can see your email. It is never shown to anyone else.</p>
            <h3 className={H3}>Sign out</h3>
            <SignOutButton className="mt-2" />
            <SignOutEverywhere />
          </Section>

          <Section id="data" title="Privacy and data">
            <h3 className={H3}>Download my data</h3>
            <p className="mt-1 max-w-sm text-[14px] text-muted">One file with your display name, follows, linked browsers, email alert settings and posts. It never holds push addresses or keys.</p>
            <Button asChild variant="outline" className="mt-2">
              <a href="/api/account/export" download="txsixmanfootball-my-data.json">Download my data</a>
            </Button>
            <h3 className={H3}>Delete my account</h3>
            <p className="mt-1 max-w-sm text-[14px] text-muted">Erases your display name, follows, linked browsers, email alert settings and sign-in. Alerts in a browser you never linked to your account are separate: stop them with Stop alerts on a program page.</p>
            <DeleteAccount />
            <LegalLinks className="mt-4" />
          </Section>
        </div>
      </div>
    </div>
  );
}
