# ADR 0056: Email goes to accounts 18 or older by birth year

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. The owner's decision of 2026-11-15. It relaxes one
line of ADR 0018 (no minor's data goes to a third party) for email only, and sets ADR 0053's age rule (point 2).

## Context
- ADR 0018 stores a fan's birth year, never a full date, and keeps any minor's data from third parties.
- Email alerts (ADR 0053) and the weekly digest send a fan's address to an email service (Resend), which is a third party.
- A birth year gives an age only within a year. "Certainly 18 or older" would need a birth year at least 19 years back. That
  leaves out every 18-year-old until their 19th calendar year.
- The owner was asked to choose between that rule and "18 or older by birth year", which was stated to let some 17-year-olds
  through. He chose the second.

## Decision
- Email (game alerts and the weekly digest) is available to an account whose birth year is at least 18 years back (Central
  time): `email_adult()` in migration 0022.
- For email only, this relaxes ADR 0018's rule that no minor's data goes to a third party: an account born in the year that
  turns 18 this year may be 17 for part of the year, and its address may then reach the email service.
- Nothing else changes. Sign-up stays 13 or older (ADR 0018). Push alerts and follows send no address anywhere. Other accounts
  see "not available for this account", and the database refuses their opt-in and never selects them.

## Consequences
- Some 17-year-olds can opt in to email, by the owner's decision.
- The DB test pins the edge: 17 years back is refused, 18 is eligible.
- `/privacy` should say that email is for accounts 18 or older by birth year, and names the email service's role. That sentence
  is owed with the privacy text for email.
