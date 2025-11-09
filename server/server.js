// canvas state management and room mangaement are included in these codes itself 

/* this file is the backbone of the whole collaborative drawing app.
   it runs a node.js server that hosts the client files and manages websocket connections.
   every drawing stroke, eraser move, or undo action passes through this layer before it reaches others.
   think of it as the “meeting room” where everyone’s canvas data syncs together. */

import express from "express"
import { WebSocketServer } from "ws"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

/* these lines handle file path setup in ES modules.
   since `__dirname` and `__filename` don’t exist natively in module mode, we reconstruct them manually.
   this helps us serve static files (like index.html and style.css) later. */
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/* we create a basic express app to serve the frontend files.
   the websocket communication will run on top of the same http server instance. */
const app = express()
const PORT = process.env.PORT || 8080

/* here we tell express to serve everything from the client directory.
   this allows users to open the main page without running a separate static server. */
app.use(express.static(join(__dirname, "../client")))

/* the default route simply sends our main HTML page.
   we keep it simple — no fancy routing, because this is a single-page app. */
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "../client/index.html"))
})

/* we combine http server and websocket server together.
   this lets both browser requests (html/css/js) and real-time drawing events share the same port. */
const server = createServer(app)
const wss = new WebSocketServer({ server })



//-------------ROOM MANAGEMENT:-----------------


/* this map keeps track of all rooms.
   each room contains its own users, drawing history, and redo stack.
   even though we have only one default room, this structure makes it easy to scale. */
const rooms = new Map()

/* helper that creates a new room if one doesn’t already exist.
   every room stores:
   - users: all connected participants
   - history: every stroke ever drawn
   - redoStack: actions that were undone but can be redone */
function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      history: [],
      redoStack: [],
    })
  }
  return rooms.get(roomId)
}

/* simple utility that assigns each user a unique color.
   these colors help distinguish who drew what and also color the user name beside their cursor. */
function assignColor() {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#FFA07A",
    "#98D8C8",
    "#F7DC6F",
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

//-------------CANVAS STATE MANAGEMENT:-----------------------

/* this big block below handles all websocket logic — connecting, messaging, and disconnecting users.
   every user who opens the app gets a websocket session. */
wss.on("connection", (ws) => {
  /* we store user-related info inside each connection.
     these will be assigned later when user sends a “join” event. */
  let userId = null
  let userName = null
  let userColor = null
  let roomId = "default"
  let currentStroke = [] // temporarily stores current drawing line while user is actively painting

  /* each time we receive a websocket message, it means a user did something (like drawing or undoing). */
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data)

      switch (message.type) {
        /* when a user first joins, they send their id, name, and room info.
           we create the room (if not already present), register the user, and notify everyone. */
        case "join": {
          userId = message.userId
          userName = message.userName
          roomId = message.roomId || "default"
          userColor = assignColor()

          const room = getRoom(roomId)
          room.users.set(userId, { userName, color: userColor })

          ws.roomId = roomId
          ws.userId = userId

          /* after user joins, we immediately send them full room data:
             - their assigned color,
             - all currently connected users,
             - and the full drawing history so they see the latest state. */
          ws.send(
            JSON.stringify({
              type: "joined",
              color: userColor,
              users: Array.from(room.users, ([id, user]) => ({
                userId: id,
                ...user,
              })),
              history: room.history,
            })
          )

          /* then we broadcast a small message to everyone else saying a new user joined. */
          broadcastToRoom(roomId, {
            type: "userJoined",
            user: { userId, userName, color: userColor },
          })
          break
        }

        /* when user presses down the mouse or finger, we start a new stroke.
           currentStroke keeps track of this sequence until released. */
        case "startStroke": {
          currentStroke = []
          break
        }

        /* while user moves mouse (dragging), we collect the line segments as part of current stroke.
           we also broadcast these live segments instantly so others see it as it happens. */
        case "draw": {
          const room = getRoom(roomId)
          const action = { userId, type: message.tool, data: message.data }
          currentStroke.push(action)

          /* broadcasting each stroke segment gives real-time smooth updates to all other clients. */
          broadcastToRoom(roomId, {
            type: "draw",
            action,
          })
          break
        }

        /* when user lifts mouse or ends touch, we mark stroke as complete.
           now we add the entire stroke as one entry to history so that undo/redo works line by line. */
        case "endStroke": {
          const room = getRoom(roomId)
          if (currentStroke.length > 0) {
            room.history.push([...currentStroke])
            room.redoStack = [] // once a new stroke is added, redo stack resets
            currentStroke = []
          }
          break
        }

        /* every cursor move (even when not drawing) gets broadcast to others
           so everyone can see who’s pointing where in real time. */
        case "cursor": {
          broadcastToRoom(roomId, {
            type: "cursorMove",
            userId,
            userName,
            color: userColor,
            x: message.x,
            y: message.y,
          })
          break
        }

        /* undo action removes the most recent stroke (no matter who drew it),
           stores it into redoStack, and then sends updated history to all clients. */
        case "undo": {
          const room = getRoom(roomId)
          if (room.history.length > 0) {
            const last = room.history.pop()
            room.redoStack.push(last)
          }
          broadcastToRoom(roomId, {
            type: "history",
            history: room.history,
          })
          break
        }

        /* redo restores the most recently undone stroke by moving it back to history.
           again, this syncs for everyone at once to keep canvases identical. */
        case "redo": {
          const room = getRoom(roomId)
          if (room.redoStack.length > 0) {
            const redoStroke = room.redoStack.pop()
            room.history.push(redoStroke)
          }
          broadcastToRoom(roomId, {
            type: "history",
            history: room.history,
          })
          break
        }

        /* clear removes every stroke from history and redo stack.
           once broadcast, all connected users’ canvases become empty instantly. */
        case "clear": {
          const room = getRoom(roomId)
          room.history = []
          room.redoStack = []
          broadcastToRoom(roomId, { type: "history", history: [] })
          break
        }
      }
    } catch (err) {
      /* just a simple safeguard — if any malformed message arrives,
         we log it but avoid crashing the whole server. */
      console.error("Error handling message:", err)
    }
  })

  /* this event triggers when a websocket connection closes — 
     like when user closes tab, loses internet, or sleeps their computer. */
  ws.on("close", () => {
    if (userId && roomId) {
      const room = getRoom(roomId)
      room.users.delete(userId)
      /* notify everyone that this user left so UI can remove their name and cursor. */
      broadcastToRoom(roomId, { type: "userLeft", userId })
    }
  })
})

/* helper function to broadcast messages to every client in a specific room.
   we loop through all websocket connections and send JSON to those in the same room. */
function broadcastToRoom(roomId, message) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.roomId === roomId) {
      client.send(JSON.stringify(message))
    }
  })
}

/* finally, start listening on the defined port.
   this logs helpful info to console so we know both http and websocket servers are running. */
server.listen(PORT, () => {
  console.log(` Server running at http://localhost:${PORT}`)
  console.log(` WebSocket server ready at ws://localhost:${PORT}`)
})
