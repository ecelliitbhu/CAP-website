import { cookies } from "next/headers";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import {
  exchangeGoogleCodeForProfile,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/admin/google-oauth";
import { lookupAdminUserByEmail } from "@/lib/admin/auth";
import {
  createSignedSessionToken,
  SESSION_COOKIE_NAME,
  createParticipantSessionToken,
  PARTICIPANT_COOKIE_NAME,
} from "@/lib/admin/session";
import { findParticipant } from "@/lib/admin/store";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const portalCookie = cookieStore.get("cap_oauth_portal")?.value;
  const isParticipant = portalCookie === "participant";
  const isSignup = portalCookie === "signup";
  const loginUrl = new URL((isParticipant || isSignup) ? "/portal/login" : "/admin/login", request.url);

  // 1. Rate limiting (max 15 attempts per 5 minutes per IP)
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`auth:callback:${ip}`, 15, 5 * 60 * 1000);
  if (!rateLimit.success) {
    loginUrl.searchParams.set("error", "rate_limited");
    return NextResponse.redirect(loginUrl);
  }

  // 2. Extract code, state, and error from Google
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    loginUrl.searchParams.set("error", "oauth_denied");
    return NextResponse.redirect(loginUrl);
  }

  if (!code || !state) {
    loginUrl.searchParams.set("error", "invalid_callback");
    return NextResponse.redirect(loginUrl);
  }

  // 3. Verify OAuth CSRF state cookie
  const signedStateToken = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (!signedStateToken || !verifyOAuthState(state, signedStateToken)) {
    loginUrl.searchParams.set("error", "state_mismatch");
    return NextResponse.redirect(loginUrl);
  }

  try {
    // 4. Exchange authorization code for Google profile
    const profile = await exchangeGoogleCodeForProfile(code);

    // 5a. Handle Signup OAuth Flow (new registration via Google)
    if (isSignup) {
      // Always redirect to the registration form with email + name pre-filled
      const regUrl = new URL("/portal/register", request.url);
      regUrl.searchParams.set("email", profile.email);
      regUrl.searchParams.set("name", profile.name);

      const response = NextResponse.redirect(regUrl);
      // Clear portal cookie
      response.cookies.set("cap_oauth_portal", "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
      response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
      return response;
    }

    // 5b. Handle Participant OAuth Login Flow
    if (isParticipant) {
      const participant = await findParticipant(profile.email);
      if (!participant) {
        // Participant not found — send to sign-up flow instead
        const regUrl = new URL("/portal/register", request.url);
        regUrl.searchParams.set("email", profile.email);
        regUrl.searchParams.set("name", profile.name);
        regUrl.searchParams.set("notice", "not_registered");
        return NextResponse.redirect(regUrl);
      }

      // Generate signed participant session token (30 days validity)
      const sessionToken = createParticipantSessionToken({
        participantId: participant.id,
        email: participant.email,
        name: participant.name,
      });

      const dashUrl = new URL("/portal/status", request.url);
      const response = NextResponse.redirect(dashUrl);

      response.cookies.set(PARTICIPANT_COOKIE_NAME, sessionToken, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60,
        secure: process.env.NODE_ENV === "production",
      });

      response.cookies.set(OAUTH_STATE_COOKIE, "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 0,
      });

      response.cookies.set("cap_oauth_portal", "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 0,
      });

      return response;
    }

    // 6. Handle Admin Allow-list Flow
    const adminUser = await lookupAdminUserByEmail(profile.email);
    if (!adminUser) {
      loginUrl.searchParams.set("error", "not_allowlisted");
      loginUrl.searchParams.set("email", profile.email);
      return NextResponse.redirect(loginUrl);
    }

    // Generate signed session token (HMAC-SHA256, 7 days validity)
    const sessionToken = createSignedSessionToken(adminUser);

    // Redirect to /admin with secure session cookie
    const adminUrl = new URL("/admin", request.url);
    const response = NextResponse.redirect(adminUrl);

    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === "production",
    });

    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });

    return response;
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    loginUrl.searchParams.set("error", "token_exchange_failed");
    return NextResponse.redirect(loginUrl);
  }
}
