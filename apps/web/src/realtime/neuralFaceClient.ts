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
  lipRetargeting: boolean;
  motionStrength: number;
  smoothing: number;
};

export type NeuralFrameMetrics = {
  latencyMs: number;
  sequence: number;
};

type NeuralFaceCallbacks = {
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
          reject(new Error("Could not connect to the neural GPU."));
        },
        { once: true }
      );
    });
  }

  close() {
    this.connected = false;
    this.encodingFrame = false;
    this.lastFrameSentAt = 0;
    this.lastFrameReceived = 0;
    this.sequence = 0;

    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
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

  async sendVideoFrame(video: HTMLVideoElement, targetFps = 24) {
    const socket = this.socket;
    const now = performance.now();

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !this.connected ||
      this.encodingFrame ||
      socket.bufferedAmount > maxBufferedBytes ||
      video.readyState < 2 ||
      now - this.lastFrameSentAt < 1000 / targetFps
    ) {
      return false;
    }

    this.encodingFrame = true;
    this.lastFrameSentAt = now;
    const size = 512;
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
        this.captureCanvas.toBlob(resolve, "image/jpeg", 0.82)
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
        this.callbacks?.onStatus("ready", message.message ?? "Neural identity ready");
      } else if (message.type === "metrics") {
        this.callbacks?.onMetrics({
          inferenceMs: message.inferenceMs ?? 0,
          serverFps: message.serverFps ?? 0
        });
      } else if (message.type === "error") {
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
    this.callbacks?.onFrame(frame, {
      latencyMs: Math.max(0, Date.now() - capturedAt),
      sequence
    });
    this.callbacks?.onStatus("streaming", "Neural face live");
  }
}
