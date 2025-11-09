# Architecture Documentation

## Data Flow Diagram

The overall flow of data in this collaborative drawing canvas is designed to feel immediate and natural what one user draws is almost instantly visible to everyone else. The whole process is event-driven and revolves around a simple message flow between the browser and the server.

```
User Action(mouse/touch input)
   │
   ▼
Canvas draws locally(instant feedback)
   │
   ▼
WebSocket sends drawing data → server
   │
   ▼
Server validates + records stroke in room history
   │
   ▼
Server broadcasts stroke to all clients in the same room
   │
   ├──▶ Other users render the stroke
   └──▶ Origin user ignores(already drawn locally)
   ▼
All canvases stay perfectly in sync
```

When a new user joins, they don't see a blank screen. The server sends the entire drawing history for that room, and their browser replays every stroke so they're fully up to date within seconds.

This design prioritizes responsiveness(local render first), then consistency(sync through WebSockets).


## WebSocket Protocol

The client and server communicate using very lightweight JSON messages. There's no complex binary encoding just simple, readable structures that carry exactly what's needed for collaboration.

### Example Message Types

**1. Join Message (Client → Server)**
```json
{
  "type": "join",
  "userId": "user_123",
  "userName": "Sampath",
  "roomId": "default"
}
```

**2. Draw Message (Client → Server)**
```json
{
  "type": "draw",
  "tool": "stroke",
  "data": {
    "x": 100,
    "y": 120,
    "x2": 110,
    "y2": 130,
    "color": "#FF6B6B",
    "width": 4
  }
}
```

**3. Cursor Move (Client → Server)**
```json
{
  "type": "cursor",
  "x": 240,
  "y": 310
}
```

**4. Undo / Redo / Clear (Client → Server)**
```json
{ "type": "undo" }
{ "type": "redo" }
{ "type": "clear" }
```

**5. Draw Broadcast (Server → Clients)**
```json
{
  "type": "draw",
  "action": {
    "userId": "user_123",
    "type": "stroke",
    "data": {
      "x": 100,
      "y": 120,
      "x2": 110,
      "y2": 130,
      "color": "#FF6B6B",
      "width": 4
    }
  }
}
```

Every connected client listens for these messages, interprets them, and updates its own canvas accordingly.


## Undo/Redo Strategy

Undo and redo in a shared environment are tricky because multiple people might be drawing at the same time. To keep things simple and predictable, the app uses a **global action stack** that represents the full shared canvas history.

- Each stroke is treated as a single action no matter how many points it includes.  
- When a user performs **Undo**, the server removes the last stroke from the shared history and moves it to a redo stack.  
- When **Redo** is called, it brings that stroke back and rebroadcasts the updated state to all users.  

This means undo and redo affect everyone in the room which is intentional, since the entire canvas is shared.

Here's a simplified timeline of how it works:

```
T0: User A draws  → history = [A1]
T1: User B draws  → history = [A1, B1]
T2: User A undos  → history = [B1] (A1 moved to redo)
T3: User B redos  → history = [B1, A1]
```

The clients simply clear their canvases and redraw from the updated history array after every undo or redo broadcast. This ensures every user always has the same consistent view of the canvas.


## Performance Decisions

From the start, the goal was smooth drawing and low latency,even when several people are drawing at once. The optimizations are focused around rendering and network usage:

1. **Local-first drawing**  
   The canvas draws immediately on the user's screen before any network message is sent. This gives instant feedback and hides network delay completely.

2. **WebSocket throttling for cursors**  
   Cursor updates are throttled to about every 30ms, which is fast enough to look fluid but light enough to avoid spamming the network.

3. **Off-screen canvas layers**  
   The drawing and cursors are handled on separate hidden canvas layers, then composited into one visible canvas. This makes redrawing far faster and cleaner.

4. **Full redraw on resize**  
   When the window resizes, the app resizes all layers and redraws from stored history, ensuring that no stroke data gets lost or distorted.

5. **Simple JSON messages**  
   Keeping message formats minimal ensures that sending hundreds of draw events per second doesn't clog the connection.

These choices make the app extremely responsive without requiring fancy frameworks or backend scaling, even with a dozen users drawing simultaneously, it performs smoothly on a standard Node.js WebSocket server.
