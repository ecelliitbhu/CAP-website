import { assertSameOrigin, ensureDynamicConnection, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, participantLoginSchema } from "@/lib/admin/schemas";
import { findParticipant } from "@/lib/admin/store";
import { createParticipantSessionToken, PARTICIPANT_COOKIE_NAME } from "@/lib/admin/session";
import { ApiError } from "@/lib/admin/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    assertSameOrigin(request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`part_login:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many login attempts. Please wait.");
    }

    const rawBody = await readBody(request);
    const data = parseStrict(participantLoginSchema, rawBody);
    const email = (data.email || data.identifier)?.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      throw new ApiError(422, "VALIDATION_ERROR", "A valid registered email address is required.");
    }

    const participant = await findParticipant(email);
    if (!participant || participant.email.toLowerCase() !== email) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "No registered ambassador found with this email address."
      );
    }

    const token = createParticipantSessionToken({
      participantId: participant.id,
      email: participant.email,
      name: participant.name,
    });

    const response = NextResponse.json({
      ok: true,
      participant,
      token,
    });

    response.cookies.set(PARTICIPANT_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
