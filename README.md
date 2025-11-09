# Collaborative Drawing Canvas

A real-time, multi-user drawing platform that lets multiple people sketch together on the same shared canvas — instantly and seamlessly.  
Built completely with **Vanilla JavaScript**, **HTML5 Canvas**, and a **Node.js + native WebSocket** backend.  
No frameworks, no UI libraries just raw DOM, sockets, and drawing logic working together in harmony.

## About the Project

This project was built as a demonstration of real-time collaboration principles using only fundamental web technologies.  
Every brush stroke or eraser movement is synchronized across all users connected to the same session, in real time.  

It’s designed to test deep understanding of:
- Canvas API internals and optimization for smooth drawing  
- Bidirectional data flow using WebSockets  
- State management between multiple users without external frameworks  

Everything from undo/redo logic to the global drawing history is managed by hand-written logic.  
No drawing libraries or frameworks are used; everything happens at the pixel and event level.

## Features

- **Real-time Collaborative Drawing** – All connected users draw on the same shared canvas, and everyone’s updates appear instantly.  
- **Global Undo / Redo** – Works across all users in real time; undo removes the most recent stroke made by anyone.  
- **Separate Brush and Eraser Tools** – Each tool has its own adjustable size for better control.  
- **Color Picker** – Choose any color and it syncs across your own strokes in real time.  
- **User Management with Colors** – Each user gets a unique color assigned automatically and is listed in the sidebar.  
- **Live Cursor Tracking** – Shows where each user's cursor is, along with their name and color.  
- **Connection Toggle** – Click "Connected" to go offline and disable all tools, click again to reconnect.  
- **Clear All** – Removes all drawings for everyone after confirmation.  
- **Canvas Resize Handling** – Resizing preserves all drawings(no data loss).  
- **Touch Support** – Fully works with touch input on mobile devices and tablets.

## Project Structure

```
collaborative-canvas/
├── client/
│   ├── index.html             # main user interface
│   ├── style.css              # styling for layout, sidebar, and canvas
│   ├── canvas.js              # core canvas drawing logic and event handling
│   ├── websocket.js           # websocket client + ui binding + app logic
│
├── server/
│   ├── server.js              # express + websocket backend
│
├── package.json               # dependencies and start scripts
├── README.md                  # project documentation(this file)
└── ARCHITECTURE.md            # architecture explanation and flow diagram
```

## Note: 
This project doesn’t have `main.js`, `room.js` or `drawing-state.js` as separate files their logic is integrated into existing files and marked clearly with:  
- `// APP INITIALIZATION`  
- `// ROOM MANAGEMENT`  
- `// CANVAS STATE MANAGEMENT`

## Architecture Overview

### Frontend (client-side)  
The frontend runs entirely on vanilla JavaScript.  
It uses a `DrawingCanvas` class in `canvas.js` that manages:
- mouse/touch input events  
- brush and eraser drawing  
- cursor synchronization  
- rendering layers (main layer and cursor overlay)  

When the user interacts with the canvas, local drawing happens first, then events are broadcast via WebSockets to the server, which relays them to all other clients.

### Backend (server-side)  
The `server.js` file combines **Express** for serving static files and **WebSocketServer** for real-time communication.  
Each drawing session is stored as a "room" containing:
- a map of connected users  
- an array of completed strokes (history)  
- a redo stack for undone actions  

The server ensures all users see the exact same state by broadcasting every update — draw, erase, undo, redo, or clear.

### Undo / Redo & State Sync
Each stroke (a group of line segments) is treated as a single atomic action.  
Undo removes the most recent stroke and moves it to a redo stack.  
Redo restores it from that stack.  
All of this is synchronized instantly across every connected user, so no one falls out of sync.

### Communication Model
- WebSocket messages are exchanged in JSON format.
- The server handles:
  - `draw`, `startStroke`, `endStroke`
  - `cursor` (for live cursors)
  - `undo`, `redo`, `clear`
  - `join` / `userJoined` / `userLeft`

## Setup Instructions

### Requirements
- Node.js 16 or higher  
- Any modern browser (Chrome, Edge, Firefox, Safari)

### Steps

1. Clone the repository  
   ```bash
   git clone <repository-url>
   cd collaborative-canvas
   ```

2. Install dependencies  
   ```bash
   npm install
   ```

3. Start the server  
   ```bash
   npm start
   ```

4. Open your browser at:  
   ```
   http://localhost:8080
   ```

5. Enter your name when prompted and start drawing!  

6. To test multiple users, open the same link in another tab or browser.

## How to Test with Multiple Users

1. Open **two or more browser windows** or devices and go to `http://localhost:8080`.  
2. Enter different display names for each user.  
3. Draw, erase, or change color  all actions appear instantly across tabs.  
4. Try undo and redo  they affect everyone’s canvas at once.  
5. Disconnect and reconnect by clicking "Connected" / "Disconnected" to see how the app handles user states.  
6. Verify that "Online Users" updates immediately when someone joins or leaves.  

We can simulate a second room by adding `?room=room2` to the URL.

## Known Limitations / Bugs

- Undo and redo are **global**, not per-user so one person's undo may remove another's stroke.  
- When the last user disconnects, all data is lost (no database persistence).  
- Occasionally, during rapid resizing or page reloads, the last partial stroke might not save.  
- The app works on mobile, but finger drawing precision depends on browser scaling.  
- There's no authentication anyone can join any room.  

## Time Spent on the Project

| Task | Approx. Time |
|------|---------------|
| Planning & Setup | 2 hours |
| Core Canvas Drawing & Event Handling | 4 hours |
| WebSocket Integration | 4 hours |
| Undo/Redo Logic & Testing | 3 hours |
| Connection Toggle, Cursors, and User Management | 2 hours |
| Debugging, UI Polish & Comments | 2 hours |
| **Total** | **17 hours** |


