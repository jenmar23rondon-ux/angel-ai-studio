import type { RealtimeFaceSession } from "../services/api";

export type NeuralRendererStatus =
  | "idle"
  | "connecting"
  | "preparing"
  | "ready"
  | "streaming"
  | "reconnecting"
  | "error";

export type NeuralRendererOptions = {
  eyeRetargeting: boolean;
  headRotationStrength: number;
  headPitchStrength: number;
  headRollStrength: number;
  headTranslationStrength: number;
  headYawStrength: number;
  lipRetargeting: boolean;
  motionStrength: number;
  smoothing: number;
};

export type NeuralFrameMetrics = {
  latencyMs: number;
  sequence: number;
};

export type NeuralDebugSnapshot = {
  bufferedBytes: number;
  connected: boolean;
  framesReceived: number;
  framesRejected: number;
  framesSent: number;
  lastSkipReason: string;
  lastServerMessage: string;
  socketState: string;
};

type NeuralFaceCallbacks = {
  onDebug: (snapshot: NeuralDebugSnapshot) => void;
  onError: (message: string) => void;
  onFrame: (frame: ImageBitmap, metrics: NeuralFrameMetrics) => void;
  onMetrics: (metrics: { inferenceMs: number; serverFps: number }) => void;
  onStatus: (status: NeuralRendererStatus, message: string) => void;
};

const frameHeaderBytes = 12;
const maxBufferedBytes = 512 * 1024;

export class NeuralFaceClient {
  private readonly captureCanvas = document.createElement("canvas");
  private callbacks: NeuralFaceCallbacks | null = null;
  private connected = false;
  private encodingFrame = false;
  private framesReceived = 0;
  private framesRejected = 0;
  private framesSent = 0;
  private lastDebugAt = 0;
  private lastServerMessage = "none";
  private lastSkipReason = "not started";
  private lastFrameSentAt = 0;
  private lastFrameReceived = 0;
  private sequence = 0;
  private socket: WebSocket | null = null;

  async connect(
    session: RealtimeFaceSession,
    referenceImage: string,
    referenceType: "self" | "fictional" | "licensed",
    options: NeuralRendererOptions,
    callbacks: NeuralFaceCallbacks
  ) {
    this.close();
    this.callbacks = callbacks;
    callbacks.onStatus("connecting", "Connecting to neural GPU");

    const url = new URL(session.wsUrl);
    url.searchParams.set("token", session.token);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("message", (event) => void this.handleMessage(event));
    socket.addEventListener("close", (event) => {
      this.connected = false;
      this.emitDebug(true);
      if (this.socket === socket) {
        const message = event.reason || "Neural renderer disconnected";
        callbacks.onStatus(event.code === 1000 ? "idle" : "error", message);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("The GPU did not answer in time."));
      }, 15_000);

      socket.addEventListener(
        "open",
        () => {
          window.clearTimeout(timeout);
          callbacks.onStatus("preparing", "Encoding the reference identity");
          this.emitDebug(true);
          socket.send(
            JSON.stringify({
              consentConfirmed: true,
              options,
              referenceImage,
              referenceType,
              type: "init"
            })
          );
          resolve();
        },
        { once: true }
      );

      socket.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          this.lastSkipReason = "websocket error";
          this.emitDebug(true);
          reject(new Error("Could not connect to the neural GPU."));
        },
        { once: true }
      );
    });
  }

  close() {
    this.connected = false;
    this.encodingFrame = false;
    this.framesReceived = 0;
    this.framesRejected = 0;
    this.framesSent = 0;
    this.lastServerMessage = "closed";
    this.lastSkipReason = "closed";
    this.lastFrameSentAt = 0;
    this.lastFrameReceived = 0;
    this.sequence = 0;

    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.emitDebug(true);
  }

  updateOptions(options: NeuralRendererOptions) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ options, type: "options" }));
    }
  }

  calibrate() {
    if (this.socket?.readyState === WebSocket.OPEN && this.connected) {
      this.socket.send(JSON.stringify({ type: "calibrate" }));
    }
  }

  async sendVideoFrame(video: HTMLVideoElement, targetFps = 8) {
    const socket = this.socket;
    const now = performance.now();

    const skipReason =
      !socket
        ? "socket not created"
        : socket.readyState !== WebSocket.OPEN
          ? "socket not open"
          : !this.connected
            ? "waiting for identity ready"
            : this.encodingFrame
              ? "encoding previous frame"
              : socket.bufferedAmount > maxBufferedBytes
                ? "GPU buffer full"
                : video.readyState < 2
                  ? "camera frame not ready"
                  : now - this.lastFrameSentAt < 1000 / targetFps
                    ? "frame rate limited"
                    : "";

    if (skipReason) {
      this.lastSkipReason = skipReason;
      this.emitDebug();
      return false;
    }

    this.encodingFrame = true;
    this.lastFrameSentAt = now;
    const size = 384;
    this.captureCanvas.width = size;
    this.captureCanvas.height = size;
    const context = this.captureCanvas.getContext("2d", { alpha: false });

    if (!context) {
      this.encodingFrame = false;
      return false;
    }

    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - sourceSize) / 2;
    const sourceY = (video.videoHeight - sourceSize) / 2;
    context.save();
    context.translate(size, 0);
    context.scale(-1, 1);
    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    context.restore();

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        this.captureCanvas.toBlob(resolve, "image/jpeg", 0.72)
      );

      if (!blob || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const packet = new ArrayBuffer(frameHeaderBytes + jpeg.byteLength);
      const view = new DataView(packet);
      const sequence = ++this.sequence;
      view.setUint32(0, sequence, true);
      view.setFloat64(4, performance.timeOrigin + now, true);
      new Uint8Array(packet, frameHeaderBytes).set(jpeg);
      this.socket.send(packet);
      this.framesSent += 1;
      this.lastSkipReason = "sent frame";
      this.emitDebug();
      return true;
    } finally {
      this.encodingFrame = false;
    }
  }

  private async handleMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      let message: {
        error?: string;
        inferenceMs?: number;
        message?: string;
        serverFps?: number;
        type: string;
      };

      try {
        message = JSON.parse(event.data);
      } catch {
        this.callbacks?.onError("The GPU returned an invalid control message.");
        return;
      }

      if (message.type === "ready") {
        this.connected = true;
        this.lastServerMessage = message.message ?? "identity ready";
        this.lastSkipReason = "identity ready";
        this.emitDebug(true);
        this.callbacks?.onStatus("ready", message.message ?? "Neural identity ready");
      } else if (message.type === "metrics") {
        this.lastServerMessage = `GPU ${message.serverFps ?? 0} fps`;
        this.emitDebug();
        this.callbacks?.onMetrics({
          inferenceMs: message.inferenceMs ?? 0,
          serverFps: message.serverFps ?? 0
        });
      } else if (message.type === "progress") {
        this.lastServerMessage = message.message ?? "GPU is processing";
        this.lastSkipReason = "GPU processing frame";
        this.emitDebug(true);
        this.callbacks?.onStatus("ready", this.lastServerMessage);
      } else if (message.type === "tracking") {
        this.framesRejected += 1;
        this.lastServerMessage = message.message ?? "GPU could not track the camera face";
        this.lastSkipReason = "GPU tracking rejected frame";
        this.emitDebug(true);
        this.callbacks?.onStatus("ready", this.lastServerMessage);
      } else if (message.type === "error") {
        this.lastServerMessage = message.error ?? "GPU error";
        this.emitDebug(true);
        this.callbacks?.onError(message.error ?? "Neural rendering failed.");
        this.callbacks?.onStatus("error", message.error ?? "Neural rendering failed");
      }
      return;
    }

    const packet = event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer();
    if (packet.byteLength <= frameHeaderBytes) {
      return;
    }

    const view = new DataView(packet);
    const sequence = view.getUint32(0, true);
    if (sequence <= this.lastFrameReceived) {
      return;
    }
    const capturedAt = view.getFloat64(4, true);
    const jpeg = packet.slice(frameHeaderBytes);
    const frame = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
    if (sequence <= this.lastFrameReceived) {
      frame.close();
      return;
    }
    this.lastFrameReceived = sequence;
    this.framesReceived += 1;
    this.lastServerMessage = `received frame ${sequence}`;
    this.lastSkipReason = "received frame";
    this.emitDebug();
    this.callbacks?.onFrame(frame, {
      latencyMs: Math.max(0, Date.now() - capturedAt),
      sequence
    });
    this.callbacks?.onStatus("streaming", "Neural face live");
  }

  private emitDebug(force = false) {
    const now = performance.now();
    if (!force && now - this.lastDebugAt < 250) {
      return;
    }

    this.lastDebugAt = now;
    const socketState =
      this.socket?.readyState === WebSocket.CONNECTING
        ? "connecting"
        : this.socket?.readyState === WebSocket.OPEN
          ? "open"
          : this.socket?.readyState === WebSocket.CLOSING
            ? "closing"
            : this.socket?.readyState === WebSocket.CLOSED
              ? "closed"
              : "none";

    this.callbacks?.onDebug({
      bufferedBytes: this.socket?.bufferedAmount ?? 0,
      connected: this.connected,
      framesReceived: this.framesReceived,
      framesRejected: this.framesRejected,
      framesSent: this.framesSent,
      lastSkipReason: this.lastSkipReason,
      lastServerMessage: this.lastServerMessage,
      socketState
    });
  }
}
