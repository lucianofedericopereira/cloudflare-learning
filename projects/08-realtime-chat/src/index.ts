/**
 * 08 - Real-time Chat
 *
 * A real-time chat application with:
 * - Durable Objects for room state
 * - WebSocket connections
 * - Presence detection
 * - Message persistence in D1
 */

export { ChatRoom } from "./chatroom";

export interface Env {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace;
}

interface Room {
  id: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: string;
}

interface Message {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  content: string;
  type: string;
  created_at: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // WebSocket Connection
      // ============================================

      // GET /rooms/:id/websocket
      if (pathname.match(/^\/rooms\/[\w-]+\/websocket$/) && request.method === "GET") {
        const roomId = pathname.split("/")[2];
        const username = url.searchParams.get("username") || "Anonymous";
        const userId = url.searchParams.get("userId") || crypto.randomUUID().slice(0, 8);

        // Get or create the Durable Object for this room
        const id = env.CHAT_ROOM.idFromName(roomId);
        const stub = env.CHAT_ROOM.get(id);

        // Forward the request to the Durable Object
        const newUrl = new URL(request.url);
        newUrl.searchParams.set("username", username);
        newUrl.searchParams.set("userId", userId);
        newUrl.searchParams.set("roomId", roomId);

        return stub.fetch(new Request(newUrl, request));
      }

      // ============================================
      // Room Management
      // ============================================

      // GET /rooms - List rooms
      if (pathname === "/rooms" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM rooms ORDER BY name"
        ).all<Room>();

        return Response.json(
          { rooms: results || [] },
          { headers: corsHeaders }
        );
      }

      // POST /rooms - Create room
      if (pathname === "/rooms" && request.method === "POST") {
        const body = (await request.json()) as {
          name: string;
          description?: string;
          isPrivate?: boolean;
          password?: string;
        };

        if (!body.name) {
          return Response.json(
            { error: "name is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const id = body.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

        // Check if room exists
        const existing = await env.DB.prepare(
          "SELECT id FROM rooms WHERE id = ?"
        )
          .bind(id)
          .first();

        if (existing) {
          return Response.json(
            { error: "Room already exists" },
            { status: 409, headers: corsHeaders }
          );
        }

        let passwordHash = null;
        if (body.password) {
          const encoder = new TextEncoder();
          const data = encoder.encode(body.password);
          const hash = await crypto.subtle.digest("SHA-256", data);
          passwordHash = Array.from(new Uint8Array(hash))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }

        await env.DB.prepare(
          `INSERT INTO rooms (id, name, description, is_private, password_hash)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            body.name,
            body.description || null,
            body.isPrivate ? 1 : 0,
            passwordHash
          )
          .run();

        return Response.json(
          { id, name: body.name },
          { status: 201, headers: corsHeaders }
        );
      }

      // GET /rooms/:id - Get room details
      if (pathname.match(/^\/rooms\/[\w-]+$/) && request.method === "GET") {
        const roomId = pathname.split("/")[2];

        const room = await env.DB.prepare(
          "SELECT * FROM rooms WHERE id = ?"
        )
          .bind(roomId)
          .first<Room>();

        if (!room) {
          return Response.json(
            { error: "Room not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Get active users from Durable Object
        const id = env.CHAT_ROOM.idFromName(roomId);
        const stub = env.CHAT_ROOM.get(id);
        const presenceResponse = await stub.fetch(
          new Request(`http://internal/presence`)
        );
        const { users } = (await presenceResponse.json()) as { users: unknown[] };

        return Response.json(
          {
            ...room,
            isPrivate: room.is_private === 1,
            activeUsers: users,
          },
          { headers: corsHeaders }
        );
      }

      // GET /rooms/:id/messages - Get message history
      if (pathname.match(/^\/rooms\/[\w-]+\/messages$/) && request.method === "GET") {
        const roomId = pathname.split("/")[2];
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
        const before = url.searchParams.get("before");

        let query = `SELECT * FROM messages WHERE room_id = ? AND deleted = 0`;
        const params: (string | number)[] = [roomId];

        if (before) {
          query += ` AND created_at < ?`;
          params.push(before);
        }

        query += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        const { results } = await env.DB.prepare(query)
          .bind(...params)
          .all<Message>();

        // Reverse to get chronological order
        const messages = (results || []).reverse();

        return Response.json({ messages }, { headers: corsHeaders });
      }

      // ============================================
      // Home / Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Real-time Chat",
            version: "1.0.0",
            endpoints: {
              "GET /rooms": "List all rooms",
              "POST /rooms": "Create a new room",
              "GET /rooms/:id": "Get room details",
              "GET /rooms/:id/messages": "Get message history",
              "GET /rooms/:id/websocket": "WebSocket connection",
            },
            websocket: {
              connect: "GET /rooms/:id/websocket?username=yourname",
              sendMessage: '{"type":"message","content":"Hello!"}',
              typing: '{"type":"typing","isTyping":true}',
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
