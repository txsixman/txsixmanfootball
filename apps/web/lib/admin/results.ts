// What a server action sends back to its form. Plain data, so it crosses to the client component.
export type FormState = { ok?: string; error?: string; fields?: Record<string, string> };
