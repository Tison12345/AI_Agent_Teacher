import { getSession } from "@/lib/auth/server";
import { SiteNav } from "./SiteNav";

/** The navigation for the signed-in user (demo sign-in). Reads the cookie on the server, so it streams in. */
export async function SessionNav() {
  return <SiteNav session={await getSession()} />;
}
