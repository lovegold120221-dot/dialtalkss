import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!serverUrl || !apiKey || !apiSecret) {
    return res.status(503).json({ error: "LiveKit server credentials are not configured." });
  }

  const roomName = `dialtalk-${crypto.randomUUID()}`;
  const identity = `web-${crypto.randomUUID()}`;
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: "10m" });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: "AbbieCSR",
        metadata: JSON.stringify({ source: "dialtalk-crm" }),
      }),
    ],
  });

  res.setHeader("Cache-Control", "no-store");
  return res.status(201).json({
    server_url: serverUrl,
    participant_token: await token.toJwt(),
  });
}
