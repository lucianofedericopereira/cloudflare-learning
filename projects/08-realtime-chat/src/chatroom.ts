/**
 * ChatRoom Durable Object
 *
 * Handles WebSocket connections and real-time messaging for a chat room
 */

export interface Env {
  DB: D1Database;
}

interface UserInfo {
  odId: string;
  odUsername: string;
  joinedAt: number;
  isTyping: boolean;
}

interface ChatMessage {
  type: "message" | "typing" | "presence" | "join" | "leave" | "history" | "error";
  [key: string]: unknown;
}

export class ChatRoom {
  private state: DurableObjectState;
  private env: Env;
  private users: Map<WebSocket, UserInfo> = new Map();
  private roomId: string = "";

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore connections on wake from hibernation
    this.state.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment() as UserInfo | null;
      if (meta) {
        this.users.set(ws, meta);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle presence request (internal)
    if (url.pathname === "/presence") {
      const users = Array.from(this.users.values()).map((u) => ({
        odId: u.odId,
        odUsername: u.odUsername,
        isTyping: u.isTyping,
      }));
      return Response.json({ users });
    }

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const username = url.searchParams.get("username") || "Anonymous";
    const odId = url.searchParams.get("userId") || crypto.randomUUID().slice(0, 8);
    this.roomId = url.searchParams.get("roomId") || "unknown";

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // User info
    const userInfo: UserInfo = {
      odId,
      odUsername: username,
      joinedAt: Date.now(),
      isTyping: false,
    };

    // Accept with hibernation support
    this.state.acceptWebSocket(server);
    server.serializeAttachment(userInfo);
    this.users.set(server, userInfo);

    // Send recent messages
    this.sendHistory(server);

    // Broadcast join
    this.broadcast(
      {
        type: "join",
        user: { odId, odUsername: username },
        timestamp: new Date().toISOString(),
      },
      server
    );

    // Send current presence
    this.sendPresence(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const userInfo = this.users.get(ws);
    if (!userInfo) return;

    try {
      const data = JSON.parse(message as string) as { type: string; content?: string; isTyping?: boolean };

      switch (data.type) {
        case "message":
          await this.handleMessage(ws, userInfo, data.content || "");
          break;
        case "typing":
          this.handleTyping(ws, userInfo, data.isTyping || false);
          break;
        default:
          ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
      }
    } catch (error) {
      console.error("Message handling error:", error);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const userInfo = this.users.get(ws);
    this.users.delete(ws);

    if (userInfo) {
      this.broadcast({
        type: "leave",
        odId: userInfo.odId,
        odUsername: userInfo.odUsername,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
    const userInfo = this.users.get(ws);
    this.users.delete(ws);

    if (userInfo) {
      this.broadcast({
        type: "leave",
        odId: userInfo.odId,
        odUsername: userInfo.odUsername,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleMessage(ws: WebSocket, userInfo: UserInfo, content: string) {
    if (!content.trim()) return;

    const messageId = `msg_${crypto.randomUUID().slice(0, 12)}`;
    const timestamp = new Date().toISOString();

    // Store in D1
    try {
      await this.env.DB.prepare(
        `INSERT INTO messages (id, room_id, user_id, username, content, type)
         VALUES (?, ?, ?, ?, ?, 'text')`
      )
        .bind(messageId, this.roomId, userInfo.odId, userInfo.odUsername, content)
        .run();
    } catch (error) {
      console.error("Failed to store message:", error);
    }

    // Broadcast to all
    this.broadcast({
      type: "message",
      message: {
        id: messageId,
        odId: userInfo.odId,
        odUsername: userInfo.odUsername,
        content,
        timestamp,
      },
    });

    // Clear typing indicator
    userInfo.isTyping = false;
    ws.serializeAttachment(userInfo);
  }

  private handleTyping(ws: WebSocket, userInfo: UserInfo, isTyping: boolean) {
    userInfo.isTyping = isTyping;
    ws.serializeAttachment(userInfo);

    this.broadcast(
      {
        type: "typing",
        odId: userInfo.odId,
        odUsername: userInfo.odUsername,
        isTyping,
      },
      ws
    );
  }

  private async sendHistory(ws: WebSocket) {
    try {
      const { results } = await this.env.DB.prepare(
        `SELECT * FROM messages WHERE room_id = ? AND deleted = 0
         ORDER BY created_at DESC LIMIT 50`
      )
        .bind(this.roomId)
        .all();

      const messages = (results || []).reverse();

      ws.send(
        JSON.stringify({
          type: "history",
          messages,
        })
      );
    } catch (error) {
      console.error("Failed to load history:", error);
    }
  }

  private sendPresence(ws: WebSocket) {
    const users = Array.from(this.users.values()).map((u) => ({
      odId: u.odId,
      odUsername: u.odUsername,
      isTyping: u.isTyping,
    }));

    ws.send(
      JSON.stringify({
        type: "presence",
        users,
      })
    );
  }

  private broadcast(message: ChatMessage, exclude?: WebSocket) {
    const data = JSON.stringify(message);

    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(data);
        } catch (error) {
          // Connection might be closed
        }
      }
    }
  }
}
