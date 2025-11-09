//app initialization inculded in this code itself.
/* this script is the main controller for the collaborative drawing app.
   it connects the frontend canvas to the backend websocket server so that multiple users can draw together in real time.
   it also handles user interface updates, online user management, connection toggling, and synchronizing all strokes across people. */

import { DrawingCanvas } from "./canvas.js"

/* this class acts like the "brain" of the client side.
   it manages websocket messages, canvas drawing synchronization, user interactions, and even connection state toggling. */
class CollaborativeDrawing {
  constructor(canvasId, serverUrl = `ws://${location.hostname}:8080`) {
    /* we initialize the drawing canvas instance that directly controls brush and eraser actions.
       every stroke drawn or erased eventually passes through that class. */
    this.canvas = new DrawingCanvas(canvasId)
    /* the websocket server url is constructed dynamically so that it works locally without hardcoding. */
    this.serverUrl = serverUrl
    /* we store websocket reference here. */
    this.ws = null
    /* each user gets a random unique id, making sure two users don’t overwrite each other’s state. */
    this.userId = "user_" + Math.random().toString(36).substr(2, 9)
    /* the user’s visible name (entered from the popup modal). */
    this.userName = null
    /* the user’s drawing color (randomly assigned by the server). */
    this.userColor = "#000000"
    /* maps and tracking for who's currently connected and where their cursors are. */
    this.onlineUsers = new Map()
    this.remoteCursors = new Map()
    /* used for manually disconnecting and reconnecting through UI toggle. */
    this.isManuallyDisconnected = false
    /* keeps a copy of drawing history so that we can restore the state after window resize. */
    this.lastHistory = []
    /* global flag so that even canvas.js knows whether the app is connected or not. */
    window.isConnected = false

    /* here we prepare two core setups — first, the modal that asks for user name, 
       and second, the user interface bindings that connect buttons and tools to behavior. */
    this.setupNameModal()
    this.setupUIBindings()
  }

  /* this small modal that appears on load lets the user choose a display name.
     it stays on screen until the person hits join, preventing drawing before identity is set. */
  setupNameModal() {
    const modal = document.getElementById("nameModal")
    const input = document.getElementById("nameInput")
    const btn = document.getElementById("nameSubmit")

    modal.style.display = "flex"
    input.focus()

    btn.addEventListener("click", () => {
      /* user might leave it blank, so we generate a fun random name if empty. */
      const val = input.value.trim() || `Artist_${Math.floor(Math.random() * 1000)}`
      this.userName = val
      localStorage.setItem("userName", val)
      modal.style.display = "none"
      /* once name is ready, we connect websocket and begin the collaboration. */
      this.connectWebSocket()

      /* warn user when they try to leave tab — this is optional but prevents accidental loss. */
      window.addEventListener("beforeunload", (e) => {
        e.preventDefault()
        e.returnValue = "Leaving will clear your drawing session if you're last."
      })
    })
  }

  /* this function actually creates a websocket connection and sets up listeners for open, message, close, and error events. */
  connectWebSocket() {
    /* don’t reconnect if already open — prevents duplicate sockets. */
    if (this.ws && this.ws.readyState === 1) return

    this.ws = new WebSocket(this.serverUrl)

    /* when connection succeeds, send a join message with user identity to server. */
    this.ws.onopen = () => {
      this.send({ type: "join", userId: this.userId, userName: this.userName, roomId: this.getRoomId() })
      this.updateConnectionStatus(true)
      window.isConnected = true
      this.setToolsEnabled(true)
    }

    /* main data receiver — handles every message that comes from server. */
    this.ws.onmessage = (ev) => this.handleMessage(JSON.parse(ev.data))

    /* when connection drops (either due to internet loss or manual disconnect), we mark everything inactive. */
    this.ws.onclose = () => {
      window.isConnected = false
      this.updateConnectionStatus(false)
      this.setToolsEnabled(false)
    }

    /* same fallback for error event, since websocket errors often behave similar to disconnects. */
    this.ws.onerror = () => {
      window.isConnected = false
      this.updateConnectionStatus(false)
      this.setToolsEnabled(false)
    }
  }

  /* allows manual disconnection through UI toggle.
     once closed, the websocket cannot be used again until reconnected. */
  disconnectWebSocket() {
    if (this.ws && this.ws.readyState === 1) this.ws.close()
    this.updateConnectionStatus(false)
    window.isConnected = false
    this.setToolsEnabled(false)
  }

  /* this helper simply sends a JSON object to the websocket if connected.
     we avoid sending if connection isn’t active. */
  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify(obj))
  }

  /* handles all incoming messages from server: joined, draw, cursorMove, etc. */
  handleMessage(msg) {
    switch (msg.type) {
      case "joined":
        /* server responds to our join request by assigning us a color and sending current room state.
           we also rebuild user list and drawing history immediately. */
        this.userColor = msg.color
        this.onlineUsers = new Map(msg.users.map((u) => [u.userId, u]))
        this.updateUserList()
        this.redrawHistory(msg.history)
        this.lastHistory = msg.history
        this.updateConnectionStatus(true)
        break

      case "userJoined":
        /* when another user enters, we add them to our list and show a small notification. */
        this.onlineUsers.set(msg.user.userId, { userName: msg.user.userName, color: msg.user.color })
        this.updateUserList()
        this.showNotification(`${msg.user.userName} joined`)
        break

      case "userLeft":
        /* remove disconnected user and clear their cursor indicator. */
        this.onlineUsers.delete(msg.userId)
        this.remoteCursors.delete(msg.userId)
        this.updateUserList()
        break

      case "draw":
        /* when others draw, replicate their strokes on our canvas (but skip our own). */
        if (msg.action.userId !== this.userId) {
          const a = msg.action
          this.canvas.remoteDrawLine(
            a.data.x,
            a.data.y,
            a.data.x2 || a.data.x,
            a.data.y2 || a.data.y,
            a.data.color,
            a.data.width,
            a.type
          )
        }
        break

      case "cursorMove":
        /* shows the real-time position of other users’ cursors with their name and color. */
        if (msg.userId === this.userId) return
        this.remoteCursors.set(msg.userId, { x: msg.x, y: msg.y, name: msg.userName, color: msg.color })
        this.canvas.drawRemoteCursor(msg.x, msg.y, msg.userName, msg.color)
        break

      case "history":
        /* full history updates happen during undo/redo or clear events. */
        this.redrawHistory(msg.history)
        this.lastHistory = msg.history
        break
    }
  }

  /* clears the canvas and redraws everything based on the received history array. */
  redrawHistory(history) {
    this.canvas.clear()
    if (!Array.isArray(history)) return
    history.forEach((stroke) => {
      const segments = Array.isArray(stroke) ? stroke : [stroke]
      segments.forEach((a) => {
        if (!a || !a.data) return
        this.canvas.remoteDrawLine(a.data.x, a.data.y, a.data.x2 || a.data.x, a.data.y2 || a.data.y, a.data.color, a.data.width, a.type)
      })
    })
  }

  /* binds every button and slider in the interface to its respective action.
     this section is where UI meets logic. */
  setupUIBindings() {
    /* these custom events are emitted by canvas.js and tell server about drawing progress. */
    window.addEventListener("strokeStart", (e) => this.send({ type: "startStroke", tool: e.detail.tool, color: e.detail.color, width: e.detail.width }))
    window.addEventListener("draw", (e) => this.send({ type: "draw", tool: e.detail.tool, data: e.detail }))
    window.addEventListener("strokeEnd", () => this.send({ type: "endStroke" }))
    window.addEventListener("cursorMove", (e) => this.send({ type: "cursor", x: e.detail.x, y: e.detail.y }))

    /* color picker instantly changes brush color. */
    document.getElementById("colorPicker")?.addEventListener("input", (e) => this.canvas.setColor(e.target.value))

    /* slider controls for brush size and live output. */
    const brush = document.getElementById("brushWidth")
    const brushOut = document.getElementById("brushWidthDisplay")
    brush?.addEventListener("input", (e) => {
      const val = Number(e.target.value)
      this.canvas.setBrushWidth(val)
      if (brushOut) brushOut.textContent = `${val}px`
    })

    /* slider for eraser width — works separately from brush width. */
    const erase = document.getElementById("eraserWidth")
    const eraseOut = document.getElementById("eraserWidthDisplay")
    erase?.addEventListener("input", (e) => {
      const val = Number(e.target.value)
      this.canvas.setEraserWidth(val)
      if (eraseOut) eraseOut.textContent = `${val}px`
    })

    /* toggle between brush and eraser tools, with visual highlight. */
    document.getElementById("brushTool")?.addEventListener("click", () => {
      this.canvas.setTool("stroke")
      document.getElementById("brushTool")?.classList.add("active")
      document.getElementById("eraserTool")?.classList.remove("active")
    })

    document.getElementById("eraserTool")?.addEventListener("click", () => {
      this.canvas.setTool("erase")
      document.getElementById("eraserTool")?.classList.add("active")
      document.getElementById("brushTool")?.classList.remove("active")
    })

    /* undo, redo, and clear buttons send respective commands to server. */
    document.getElementById("undoBtn")?.addEventListener("click", () => this.send({ type: "undo" }))
    document.getElementById("redoBtn")?.addEventListener("click", () => this.send({ type: "redo" }))
    document.getElementById("clearBtn")?.addEventListener("click", () => {
      if (confirm("Clear the entire canvas for everyone?")) this.send({ type: "clear" })
    })

    /* manual connect/disconnect toggle using the connection-status element.
       this lets users simulate going offline without closing the browser. */
    const status = document.getElementById("connectionStatus")
    if (status) {
      status.addEventListener("click", () => {
        if (window.isConnected) {
          this.isManuallyDisconnected = true
          this.disconnectWebSocket()
          this.showNotification("You are now offline. Click 'Disconnected' to reconnect.")
        } else {
          this.isManuallyDisconnected = false
          this.connectWebSocket()
          this.showNotification("Reconnected successfully.")
        }
      })
    }

    /* when the window resizes, redraw all strokes so that nothing visually disappears. */
    window.addEventListener("canvasResized", () => {
      if (this.lastHistory && this.lastHistory.length > 0) this.redrawHistory(this.lastHistory)
    })
  }

  /* disables or enables all interactive UI tools when user connects or disconnects. */
  setToolsEnabled(enabled) {
    const toolEls = document.querySelectorAll(
      "#brushTool, #eraserTool, #colorPicker, #brushWidth, #eraserWidth, #undoBtn, #redoBtn, #clearBtn"
    )
    toolEls.forEach((el) => (el.disabled = !enabled))
    this.canvas.canvas.style.pointerEvents = enabled ? "auto" : "none"
  }

  /* updates online users sidebar list whenever someone joins or leaves. */
  updateUserList() {
    const el = document.getElementById("userList")
    if (!el) return
    el.innerHTML = Array.from(this.onlineUsers)
      .map(([id, u]) => `<div class="user-item" style="border-left:4px solid ${u.color}">${u.userName}</div>`)
      .join("")
  }

  /* updates the connection status indicator color and text dynamically.
     when connected, shows user name and color; when disconnected, resets style. */
  updateConnectionStatus(ok) {
    const el = document.getElementById("connectionStatus")
    if (!el) return
    if (ok) {
      el.textContent = `Connected (${this.userName})`
      el.className = "connection-status connected"
      el.style.color = this.userColor
    } else {
      el.textContent = "Disconnected"
      el.className = "connection-status disconnected"
      el.style.color = ""
    }
  }

  /* shows temporary floating messages at the bottom corner.
     just a friendly feedback feature when people join or reconnect. */
  showNotification(msg) {
    const n = document.createElement("div")
    n.className = "notification"
    n.textContent = msg
    document.body.appendChild(n)
    setTimeout(() => n.remove(), 3000)
  }

  /* simple helper that figures out which room we are in (default or ?room=xyz in URL). */
  getRoomId() {
    const p = new URLSearchParams(window.location.search)
    return p.get("room") || "default"
  }
}

//---------APP INITIALIZATION---------------------

/* when the page fully loads, we create a new collaborative drawing instance
   which immediately sets up modal, websocket connection, and tool bindings. */
document.addEventListener("DOMContentLoaded", () => new CollaborativeDrawing("canvas"))
