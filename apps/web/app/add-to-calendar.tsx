import { webcalUrl } from "@/lib/calendar";

// "Add to calendar" (ADR 0095). A program or a bracket offers its feed twice: the webcal:// address an iPhone or a Mac subscribes to,
// and the same file at its https address for Google Calendar, Outlook and the rest. A game offers the one-game file. Every link is a
// 44px target, in plain words.
const LINK = "inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-4 hover:text-red";

/** A feed to subscribe to: `path` is its address on this site, `what` names it ("Jayton games"). */
export function CalendarFeedLinks({ path, what, className }: { path: string; what: string; className?: string }) {
  return (
    <div data-pagefind-ignore data-calendar className={className}>
      <p className="text-[14px] text-ink">Put {what} on your phone calendar. It updates itself as games are set and played.</p>
      <div className="flex flex-wrap items-center gap-x-5">
        <a href={webcalUrl(path)} className={LINK}>
          Add to calendar
          <span className="sr-only">: iPhone and Mac</span>
        </a>
        <a href={path} className={LINK}>
          Calendar file
          <span className="sr-only"> for Google Calendar and others</span>
        </a>
      </div>
    </div>
  );
}

/** One game's file: `path` is its address on this site. */
export function CalendarGameLink({ path }: { path: string }) {
  return (
    <p data-pagefind-ignore data-calendar>
      <a href={path} className={LINK}>
        Add to calendar
      </a>
    </p>
  );
}
