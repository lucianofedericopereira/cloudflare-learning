# 08 - Real-time Chat

A real-time chat application using Durable Objects, WebSockets, and D1.

## Learning Objectives

- Durable Objects for stateful coordination
- WebSocket connections and hibernation
- Presence detection
- Message persistence with D1

## Concepts

### Durable Objects

Durable Objects provide strongly consistent, single-threaded state:

```typescript
export class ChatRoom {
  private state: DurableObjectState;
  private connections: Map<string, WebSocket> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept the connection
      this.state.acceptWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Expected WebSocket", { status: 400 });
  }

  // Handle WebSocket messages
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);
    // Broadcast to all connections
    for (const socket of this.state.getWebSockets()) {
      socket.send(JSON.stringify(data));
    }
  }

  // Handle WebSocket close
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Clean up
  }
}
```

### WebSocket Hibernation

Hibernation allows Durable Objects to be evicted while maintaining connections:

```typescript
export class ChatRoom {
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Use hibernation API
    this.state.acceptWebSocket(server, ["user-123"]); // Tags for identification

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when a hibernated DO receives a message
  async webSocketMessage(ws: WebSocket, message: string) {
    // Get all websockets (even if DO was hibernating)
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      socket.send(message);
    }
  }

  async webSocketClose(ws: WebSocket) {
    // Connection closed
  }
}
```

### Presence System

```typescript
interface UserPresence {
  odId: string;
  username: string;
  status: "online" | "away" | "offline";
  lastSeen: number;
}

// In Durable Object
private async updatePresence(userId: string, status: string) {
  const presence: UserPresence = {
    odId: userId,
    username: this.usernames.get(userId) || "Anonymous",
    status,
    lastSeen: Date.now(),
  };

  await this.state.storage.put(`presence:${odId}`, presence);

  // Broadcast presence update
  this.broadcast({
    type: "presence",
    user: presence,
  });
}
```

### Message Schema

```typescript
interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  type: "text" | "system" | "image";
  timestamp: string;
  edited?: boolean;
  deleted?: boolean;
}

interface WebSocketMessage {
  type: "message" | "presence" | "typing" | "join" | "leave";
  payload: unknown;
}
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/rooms` | List rooms |
| POST | `/rooms` | Create room |
| GET | `/rooms/:id` | Get room details |
| GET | `/rooms/:id/messages` | Get message history |
| GET | `/rooms/:id/websocket` | WebSocket connection |

### WebSocket Messages

**Client → Server:**
```json
{ "type": "message", "content": "Hello!" }
{ "type": "typing", "isTyping": true }
{ "type": "presence", "status": "away" }
```

**Server → Client:**
```json
{ "type": "message", "message": { "id": "...", "content": "Hello!", ... } }
{ "type": "presence", "users": [...] }
{ "type": "typing", "user": "john", "isTyping": true }
{ "type": "join", "user": { "id": "...", "username": "john" } }
{ "type": "leave", "userId": "..." }
```

## Project Tasks

### Task 1: Basic Chat Room DO
- Create Durable Object for rooms
- Handle WebSocket connections
- Broadcast messages

### Task 2: Message Persistence
- Store messages in D1
- Load history on connect
- Paginated history API

### Task 3: Presence System
- Track online users
- Broadcast join/leave
- "User is typing" indicator

### Task 4: Room Management
- Create/list rooms
- Private rooms with passwords
- Room metadata

## Commands

```bash
# Create D1 database
npx wrangler d1 create realtime-chat
npx wrangler d1 execute realtime-chat --file=schema.sql

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
08-realtime-chat/
├── src/
│   ├── index.ts          # Main router
│   ├── chatroom.ts       # Durable Object
│   ├── messages.ts       # Message handling
│   └── presence.ts       # Presence system
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Create room
curl -X POST http://localhost:8787/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "General"}'

# Connect via WebSocket (use wscat or browser)
wscat -c "ws://localhost:8787/rooms/general/websocket?username=john"

# Send message
> {"type":"message","content":"Hello everyone!"}

# Get message history
curl http://localhost:8787/rooms/general/messages
```

## Client Example

```javascript
const ws = new WebSocket("wss://chat.example.com/rooms/general/websocket?username=john");

ws.onopen = () => {
  console.log("Connected!");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "message":
      displayMessage(data.message);
      break;
    case "presence":
      updateUserList(data.users);
      break;
    case "typing":
      showTypingIndicator(data.user, data.isTyping);
      break;
  }
};

// Send message
ws.send(JSON.stringify({ type: "message", content: "Hello!" }));

// Send typing indicator
ws.send(JSON.stringify({ type: "typing", isTyping: true }));
```

## Key Takeaways

1. Durable Objects provide strongly consistent state per room
2. WebSocket hibernation allows scaling to many connections
3. Store messages in D1 for persistence across DO restarts
4. Use tags with `acceptWebSocket()` to identify connections
5. Broadcast presence updates to all users in a room
