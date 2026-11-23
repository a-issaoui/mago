import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Mago has no accounts, so it must only answer under its own names. Without this, a hostile
// site could point its own domain at 127.0.0.1 (DNS rebinding) and read the library.
const ALLOWED_HOSTS = new Set((process.env.MAGO_HOSTS ?? "mago.test,127.0.0.1,localhost").split(","));

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return new NextResponse("Unknown host", { status: 421 });
  return NextResponse.next();
}
