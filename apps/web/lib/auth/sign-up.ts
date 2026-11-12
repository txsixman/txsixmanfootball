import { z } from "zod";

// Sign-up's last step: a display name and a birth year. The database checks the same things again (create_profile and
// the profile table's checks, migration 0011).

/** 3 to 24 characters: letters, numbers, spaces, dashes and underscores, starting and ending with a letter or number. */
const DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$/;

export const NAME_MESSAGE = "Use 3 to 24 letters, numbers, spaces, dashes or underscores, starting and ending with a letter or number.";

export const SignUpFields = z.object({
  displayName: z.string().trim().regex(DISPLAY_NAME, NAME_MESSAGE),
  birthYear: z.string().trim().regex(/^\d{4}$/, "Enter your birth year, four digits.").transform(Number),
  turned13: z.enum(["", "yes", "no"]).default(""),
});
