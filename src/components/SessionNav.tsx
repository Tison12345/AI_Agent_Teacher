import { connection } from "next/server";
import { getSession } from "@/lib/auth/server";
import { SiteNav } from "./SiteNav";

/** The navigation for the signed-in user. Reads the cookie on the server, so it streams in. */
export async function SessionNav() {
  await connection(); // the expiry check reads the clock, so this must wait for a real request, not the prerender
  return <SiteNav session={await getSession()} />;
}
