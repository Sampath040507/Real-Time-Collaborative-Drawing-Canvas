//this class basically runs the entire show for our drawing canvas.
//it handles user input, line drawing, cursor sync, resize logic, and event emission for real-time collaboration.
//we can think of it like the "engine" behind everything users see on screen.

export class DrawingCanvas {
  constructor(canvasId) {
    //here we grab the canvas element and its 2d context so that we can start drawing stuff on it.
    //2d context is what allows you to use methods like moveTo, lineTo, stroke, etc.
    this.canvas = document.getElementById(canvasId)
    this.ctx = this.canvas.getContext("2d")

    //these are the basic states we need for drawing.
    //isDrawing helps us know when the mouse is pressed, currentTool switches between brush and eraser.
    //the rest handle color, width, and last known cursor position.
    this.isDrawing = false
    this.currentTool = "stroke"
    this.currentColor = "#000000"
    this.brushWidth = 2
    this.eraserWidth = 10
    this.lastX = 0
    this.lastY = 0
    this.lastCursorSend = 0

    //this is where we prepare two extra layers on top of the visible canvas.
    //mainLayer holds all drawing data and cursorLayer is only for showing remote user cursors.
    this.mainLayer = document.createElement("canvas")
    this.mainCtx = this.mainLayer.getContext("2d")
    this.cursorLayer = document.createElement("canvas")
    this.cursorCtx = this.cursorLayer.getContext("2d")

    //finallywe resize everything to fit the window and attach all event listeners.
    this.resizeCanvas()
    this.setupEventListeners()
  }

  //this method handles canvas resizing without losing the drawn content.
  //canvas normally clears everything when resized, so we store the image first and reapply it later.
  resizeCanvas() {
    const parent = this.canvas.parentElement
    const tempImage = this.mainCtx.getImageData(0, 0, this.canvas.width, this.canvas.height)

    //here we sync all layers to match the parent container.
    this.canvas.width = parent.clientWidth
    this.canvas.height = parent.clientHeight
    this.mainLayer.width = this.canvas.width
    this.mainLayer.height = this.canvas.height
    this.cursorLayer.width = this.canvas.width
    this.cursorLayer.height = this.canvas.height

    //we try restoring the image data but in the first load it usually fails, so we wrap it safely.
    try {
      this.mainCtx.putImageData(tempImage, 0, 0)
    } catch {
      console.warn("canvas resized: previous image data could not be restored")
    }

    //now we redraw everything and let other scripts know resizing happened.
    this.renderCanvas()
    window.dispatchEvent(new CustomEvent("canvasResized"))
  }

  //this connects all mouse and touch events to their respective handlers.
  //it ensures both desktop and mobile devices behave smoothly when drawing.
  setupEventListeners() {
    this.canvas.addEventListener("mousedown", (e) => this.startDrawing(e))
    this.canvas.addEventListener("mousemove", (e) => this.onMove(e))
    this.canvas.addEventListener("mouseup", () => this.stopDrawing())
    this.canvas.addEventListener("mouseout", () => this.stopDrawing())

    this.canvas.addEventListener("touchstart", (e) => this.handleTouch(e))
    this.canvas.addEventListener("touchmove", (e) => this.handleTouch(e))
    this.canvas.addEventListener("touchend", () => this.stopDrawing())

    window.addEventListener("resize", () => this.resizeCanvas())
  }

  //this converts touch events into mouse events so we don’t have to write separate drawing logic for phones.
  //it basically fakes a mouse event from touch coordinates.
  handleTouch(e) {
    if (!window.isConnected) return
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    const rect = this.canvas.getBoundingClientRect()
    const event = new MouseEvent(
      e.type === "touchstart" ? "mousedown" : e.type === "touchmove" ? "mousemove" : "mouseup",
      { clientX: touch.clientX - rect.left, clientY: touch.clientY - rect.top },
    )
    this.canvas.dispatchEvent(event)
    e.preventDefault()
  }

  //this triggers when a user presses down to start a stroke.
  //it records the starting coordinates and lets other parts of the app know a new stroke began.
  startDrawing(e) {
    if (!window.isConnected) return
    const rect = this.canvas.getBoundingClientRect()
    this.isDrawing = true
    this.lastX = e.clientX - rect.left
    this.lastY = e.clientY - rect.top

    window.dispatchEvent(
      new CustomEvent("strokeStart", {
        detail: {
          tool: this.currentTool,
          color: this.currentColor,
          width: this.getCurrentWidth(),
        },
      }),
    )
  }

  //this handles mouse movement and actual drawing when the user is holding down the mouse.
  //it also keeps sending cursor position updates to other connected users.
  onMove(e) {
    if (!window.isConnected) return
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    //this throttles cursor updates so they don’t flood the network (roughly 33 fps).
    const now = Date.now()
    if (now - this.lastCursorSend > 30) {
      this.emitCursorMove(e)
      this.lastCursorSend = now
    }

    //if not drawing, no need to do anything else.
    if (!this.isDrawing) return

    //otherwise, we draw a line segment and send it out for real-time sync.
    this.drawLine(this.lastX, this.lastY, x, y, this.currentTool)
    this.emitDraw(this.lastX, this.lastY, x, y)
    this.lastX = x
    this.lastY = y
  }

  //this stops drawing when mouse is released and emits a strokeEnd event for everyone to sync.
  stopDrawing() {
    if (!this.isDrawing) return
    this.isDrawing = false
    window.dispatchEvent(new CustomEvent("strokeEnd"))
  }

  //this sends the drawing details to the websocket listeners.
  //includes coordinates, color, tool type, and brush width.
  emitDraw(x1, y1, x2, y2) {
    window.dispatchEvent(
      new CustomEvent("draw", {
        detail: {
          tool: this.currentTool,
          x: x1,
          y: y1,
          x2: x2,
          y2: y2,
          color: this.currentColor,
          width: this.getCurrentWidth(),
        },
      }),
    )
  }

  //this function just sends current cursor location to the websocket.
  emitCursorMove(e) {
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    window.dispatchEvent(new CustomEvent("cursorMove", { detail: { x, y } }))
  }

  //this is the actual drawing function for the local user.
  //if tool is erase, it clears a small square area; otherwise, it draws a rounded line.
  drawLine(fromX, fromY, toX, toY, tool = "stroke") {
    if (tool === "erase") {
      this.mainCtx.clearRect(
        toX - this.eraserWidth / 2,
        toY - this.eraserWidth / 2,
        this.eraserWidth,
        this.eraserWidth,
      )
    } else {
      this.mainCtx.strokeStyle = this.currentColor
      this.mainCtx.lineWidth = this.brushWidth
      this.mainCtx.lineCap = "round"
      this.mainCtx.lineJoin = "round"
      this.mainCtx.beginPath()
      this.mainCtx.moveTo(fromX, fromY)
      this.mainCtx.lineTo(toX, toY)
      this.mainCtx.stroke()
    }
    this.renderCanvas()
  }

  //this method handles drawing updates received from other users through websocket.
  //it does exactly the same thing as drawLine, just with passed-in parameters.
  remoteDrawLine(fromX, fromY, toX, toY, color, width, tool) {
    if (tool === "erase") {
      this.mainCtx.clearRect(toX - width / 2, toY - width / 2, width, width)
    } else {
      this.mainCtx.strokeStyle = color
      this.mainCtx.lineWidth = width
      this.mainCtx.lineCap = "round"
      this.mainCtx.lineJoin = "round"
      this.mainCtx.beginPath()
      this.mainCtx.moveTo(fromX, fromY)
      this.mainCtx.lineTo(toX, toY)
      this.mainCtx.stroke()
    }
    this.renderCanvas()
  }

  //this draws a little colored dot and username label for each connected user’s cursor position.
  //helps everyone know where others are working on the board.
  drawRemoteCursor(x, y, name, color) {
    this.cursorCtx.clearRect(0, 0, this.cursorLayer.width, this.cursorLayer.height)
    this.cursorCtx.fillStyle = color
    this.cursorCtx.beginPath()
    this.cursorCtx.arc(x, y, 4, 0, Math.PI * 2)
    this.cursorCtx.fill()
    this.cursorCtx.fillStyle = color
    this.cursorCtx.font = "12px Arial"
    this.cursorCtx.fillText(name, x + 8, y)
    this.renderCanvas()
  }

  //this draws both the main and cursor layers together onto the visible canvas.
  //this way, the board always looks complete but still logically separated in layers.
  renderCanvas() {
    this.ctx.fillStyle = "#ffffff"
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.drawImage(this.mainLayer, 0, 0)
    this.ctx.drawImage(this.cursorLayer, 0, 0)
  }

  //this simply clears the entire canvas and both layers, resetting everything to blank white.
  clear() {
    this.mainCtx.clearRect(0, 0, this.mainLayer.width, this.mainLayer.height)
    this.cursorCtx.clearRect(0, 0, this.cursorLayer.width, this.cursorLayer.height)
    this.renderCanvas()
  }

  //this set of methods just update brush color, width, and tool type dynamically when user changes them.
  setColor(color) {
    this.currentColor = color
  }

  setBrushWidth(width) {
    this.brushWidth = width
  }

  setEraserWidth(width) {
    this.eraserWidth = width
  }

  getCurrentWidth() {
    return this.currentTool === "erase" ? this.eraserWidth : this.brushWidth
  }

  setTool(tool) {
    this.currentTool = tool
  }
}

//this last bit is just a node export condition to make testing easier in backend or modular environments.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DrawingCanvas }
}
