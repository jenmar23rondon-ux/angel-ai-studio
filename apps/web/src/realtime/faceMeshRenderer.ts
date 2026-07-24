export type FacePoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

export type FaceConnection = {
  start: number;
  end: number;
};

export type FaceTriangle = [number, number, number];

export type FaceRenderControls = {
  mode: "live-swap" | "photo-reenactment";
  motionStrength: number;
  mouthStrength: number;
  eyeStrength: number;
  headRotationStrength: number;
  maskFeathering: number;
  faceScale: number;
  facePositionX: number;
  facePositionY: number;
  fit: "cover" | "contain";
  preserveLiveMouth: boolean;
};

type Point = {
  x: number;
  y: number;
};

type Bounds = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

const faceOval = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
  136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];
const mouthInterior = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const mouthLandmarks = new Set([
  0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95, 146, 178, 181, 185, 191, 267, 269, 270, 291,
  308, 310, 311, 312, 314, 317, 318, 321, 324, 375, 402, 405, 409, 415
]);
const eyeLandmarks = new Set([
  7, 33, 46, 52, 53, 55, 63, 65, 66, 70, 105, 107, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163,
  173, 246, 249, 263, 276, 282, 283, 285, 293, 295, 296, 300, 334, 336, 362, 373, 374, 380, 381, 382, 384, 385,
  386, 387, 388, 390, 398, 466
]);
const jawLandmarks = new Set([17, 152, 148, 176, 149, 150, 136, 172, 58, 132, 288, 397, 365, 379, 378, 400, 377]);
const ovalLandmarks = new Set(faceOval);
const skinSampleLandmarks = [1, 50, 101, 205, 280, 330, 425];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function buildFaceTriangles(connections: FaceConnection[]): FaceTriangle[] {
  const neighbors = new Map<number, Set<number>>();
  const edges = new Set<string>();

  for (const { start, end } of connections) {
    if (!neighbors.has(start)) {
      neighbors.set(start, new Set());
    }
    if (!neighbors.has(end)) {
      neighbors.set(end, new Set());
    }
    neighbors.get(start)?.add(end);
    neighbors.get(end)?.add(start);
    edges.add(start < end ? `${start}:${end}` : `${end}:${start}`);
  }

  const triangles = new Map<string, FaceTriangle>();

  for (const [start, adjacent] of neighbors) {
    const points = [...adjacent];
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left];
        const b = points[right];
        const edge = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edges.has(edge)) {
          continue;
        }

        const triangle = [start, a, b].sort((first, second) => first - second) as FaceTriangle;
        triangles.set(triangle.join(":"), triangle);
      }
    }
  }

  return [...triangles.values()];
}

export class FaceMeshRenderer {
  private readonly faceBuffer = document.createElement("canvas");
  private readonly maskBuffer = document.createElement("canvas");
  private readonly detailBuffer = document.createElement("canvas");
  private readonly detailMaskBuffer = document.createElement("canvas");
  private readonly sourceSampleBuffer = document.createElement("canvas");
  private referenceImage: HTMLImageElement | null = null;
  private referenceLandmarks: FacePoint[] | null = null;
  private triangles: FaceTriangle[] = [];
  private referenceLuminance = 128;
  private liveBrightness = 1;
  private renderedFrames = 0;

  setReference(image: HTMLImageElement, landmarks: FacePoint[], triangles: FaceTriangle[]) {
    this.referenceImage = image;
    this.referenceLandmarks = landmarks.map((point) => ({ ...point }));
    this.triangles = triangles;
    this.referenceLuminance = this.measureReferenceLuminance(image, landmarks);
    this.liveBrightness = 1;
  }

  clearReference() {
    this.referenceImage = null;
    this.referenceLandmarks = null;
    this.triangles = [];
  }

  render(
    output: HTMLCanvasElement,
    currentLandmarks: FacePoint[] | null,
    neutralLandmarks: FacePoint[] | null,
    controls: FaceRenderControls,
    video: HTMLVideoElement | null
  ) {
    const image = this.referenceImage;
    const reference = this.referenceLandmarks;
    const cssWidth = Math.max(1, Math.round(output.clientWidth || 960));
    const cssHeight = Math.max(1, Math.round(output.clientHeight || 540));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);

    this.resizeCanvas(output, pixelWidth, pixelHeight);
    this.resizeCanvas(this.faceBuffer, pixelWidth, pixelHeight);
    this.resizeCanvas(this.maskBuffer, pixelWidth, pixelHeight);
    this.resizeCanvas(this.detailBuffer, pixelWidth, pixelHeight);
    this.resizeCanvas(this.detailMaskBuffer, pixelWidth, pixelHeight);

    const outputContext = output.getContext("2d");
    const faceContext = this.faceBuffer.getContext("2d");
    const maskContext = this.maskBuffer.getContext("2d");
    const detailContext = this.detailBuffer.getContext("2d");
    const detailMaskContext = this.detailMaskBuffer.getContext("2d");

    if (!outputContext || !faceContext || !maskContext || !detailContext || !detailMaskContext) {
      return;
    }

    this.resetContext(outputContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(faceContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(maskContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(detailContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(detailMaskContext, pixelRatio, cssWidth, cssHeight);

    const hasLiveVideo =
      controls.mode === "live-swap" && Boolean(video && video.readyState >= 2 && video.videoWidth && video.videoHeight);
    const videoFit = hasLiveVideo && video ? this.getMediaFit(video.videoWidth, video.videoHeight, cssWidth, cssHeight, "cover") : null;

    if (hasLiveVideo && video && videoFit) {
      this.drawMirroredVideo(outputContext, video, videoFit, cssWidth);
    } else if (image) {
      const fit = this.getImageFit(image, cssWidth, cssHeight, controls.fit);
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(image, fit.left, fit.top, fit.width, fit.height);
    } else {
      return;
    }

    if (
      !image ||
      !reference ||
      !currentLandmarks ||
      !neutralLandmarks ||
      this.triangles.length === 0 ||
      currentLandmarks.length !== neutralLandmarks.length
    ) {
      return;
    }

    const targetPoints =
      hasLiveVideo && videoFit
        ? this.buildLiveTargetPoints(currentLandmarks, neutralLandmarks, videoFit, controls)
        : this.buildPhotoTargetPoints(image, cssWidth, cssHeight, currentLandmarks, neutralLandmarks, controls);
    const sourceImagePoints = reference.map((point) => ({
      x: point.x * image.naturalWidth,
      y: point.y * image.naturalHeight
    }));

    this.renderedFrames += 1;
    if (hasLiveVideo && this.renderedFrames % 6 === 0) {
      const targetLuminance = this.measureTargetLuminance(outputContext, targetPoints, pixelRatio);
      if (targetLuminance > 0 && this.referenceLuminance > 0) {
        const correction = clamp(targetLuminance / this.referenceLuminance, 0.72, 1.28);
        this.liveBrightness += (correction - this.liveBrightness) * 0.18;
      }
    }

    faceContext.imageSmoothingEnabled = true;
    faceContext.imageSmoothingQuality = "high";
    faceContext.filter = hasLiveVideo
      ? `brightness(${this.liveBrightness.toFixed(3)}) saturate(0.94) contrast(0.98)`
      : "none";

    for (const [a, b, c] of this.triangles) {
      const sourceTriangle = [sourceImagePoints[a], sourceImagePoints[b], sourceImagePoints[c]];
      const targetTriangle = this.expandTriangle([targetPoints[a], targetPoints[b], targetPoints[c]], 0.38);

      if (sourceTriangle.some((point) => !point) || targetTriangle.some((point) => !point)) {
        continue;
      }

      this.drawWarpedTriangle(faceContext, image, sourceTriangle as [Point, Point, Point], targetTriangle);
    }

    this.drawFeatheredMask(maskContext, targetPoints, controls.maskFeathering);
    faceContext.save();
    faceContext.globalCompositeOperation = "destination-in";
    faceContext.drawImage(this.maskBuffer, 0, 0, cssWidth, cssHeight);
    faceContext.restore();

    // Remove the original facial interior before compositing the one final warped face.
    outputContext.save();
    outputContext.globalCompositeOperation = "destination-out";
    outputContext.fillStyle = "#000";
    this.traceOval(outputContext, targetPoints, 0.985);
    outputContext.fill();
    outputContext.restore();

    outputContext.drawImage(this.faceBuffer, 0, 0, cssWidth, cssHeight);

    if (hasLiveVideo && video && videoFit && controls.preserveLiveMouth) {
      this.drawLiveMouthDetails(
        outputContext,
        detailContext,
        detailMaskContext,
        video,
        videoFit,
        targetPoints,
        cssWidth,
        cssHeight
      );
    }
  }

  private buildPhotoTargetPoints(
    image: HTMLImageElement,
    width: number,
    height: number,
    current: FacePoint[],
    neutral: FacePoint[],
    controls: FaceRenderControls
  ) {
    const fit = this.getImageFit(image, width, height, controls.fit);
    const referencePoints =
      this.referenceLandmarks?.map((point) => ({
        x: fit.left + point.x * fit.width,
        y: fit.top + point.y * fit.height
      })) ?? [];

    return this.buildPhotoMotionPoints(referencePoints, current, neutral, controls);
  }

  private buildPhotoMotionPoints(
    sourcePoints: Point[],
    current: FacePoint[],
    neutral: FacePoint[],
    controls: FaceRenderControls
  ) {
    const referenceBounds = this.getBounds(sourcePoints);
    const currentBounds = this.getNormalizedBounds(current);
    const neutralBounds = this.getNormalizedBounds(neutral);
    const neutralRoll = this.getEyeAngle(neutral);
    const currentRoll = this.getEyeAngle(current);
    const roll = clamp(currentRoll - neutralRoll, -0.24, 0.24) * controls.headRotationStrength;
    const neutralNose = neutral[1] ?? neutral[4];
    const currentNose = current[1] ?? current[4];
    const neutralNoseX = (neutralNose.x - neutralBounds.centerX) / neutralBounds.width;
    const currentNoseX = (currentNose.x - currentBounds.centerX) / currentBounds.width;
    const neutralNoseY = (neutralNose.y - neutralBounds.centerY) / neutralBounds.height;
    const currentNoseY = (currentNose.y - currentBounds.centerY) / currentBounds.height;
    const yaw = clamp(currentNoseX - neutralNoseX, -0.18, 0.18) * controls.headRotationStrength;
    const pitch = clamp(currentNoseY - neutralNoseY, -0.14, 0.14) * controls.headRotationStrength;
    const positionX = controls.facePositionX * referenceBounds.width;
    const positionY = controls.facePositionY * referenceBounds.height;
    const cosine = Math.cos(roll);
    const sine = Math.sin(roll);

    return sourcePoints.map((source, index) => {
      const neutralPoint = neutral[index] ?? neutralNose;
      const currentPoint = current[index] ?? currentNose;
      const neutralLocalX = (neutralPoint.x - neutralBounds.centerX) / neutralBounds.width;
      const neutralLocalY = (neutralPoint.y - neutralBounds.centerY) / neutralBounds.height;
      const currentLocalX = (currentPoint.x - currentBounds.centerX) / currentBounds.width;
      const currentLocalY = (currentPoint.y - currentBounds.centerY) / currentBounds.height;
      let featureStrength = 0.48;
      let maxX = 0.055;
      let maxY = 0.065;

      if (mouthLandmarks.has(index)) {
        featureStrength = controls.mouthStrength;
        maxX = 0.075;
        maxY = 0.11;
      } else if (eyeLandmarks.has(index)) {
        featureStrength = controls.eyeStrength;
        maxX = 0.05;
        maxY = 0.055;
      } else if (jawLandmarks.has(index)) {
        featureStrength = 0.4 + controls.mouthStrength * 0.35;
        maxY = 0.075;
      }

      const boundaryWeight = ovalLandmarks.has(index) ? 0.16 : 1;
      const deltaX =
        clamp(currentLocalX - neutralLocalX, -maxX, maxX) *
        referenceBounds.width *
        controls.motionStrength *
        featureStrength *
        boundaryWeight;
      const deltaY =
        clamp(currentLocalY - neutralLocalY, -maxY, maxY) *
        referenceBounds.height *
        controls.motionStrength *
        featureStrength *
        boundaryWeight;
      const relativeX = (source.x - referenceBounds.centerX) * controls.faceScale;
      const relativeY = (source.y - referenceBounds.centerY) * controls.faceScale;
      const headWeight = ovalLandmarks.has(index) ? 0.16 : 0.72;
      const rotatedX = relativeX * cosine - relativeY * sine;
      const rotatedY = relativeX * sine + relativeY * cosine;

      return {
        x:
          referenceBounds.centerX +
          rotatedX +
          positionX +
          deltaX +
          yaw * referenceBounds.width * headWeight,
        y:
          referenceBounds.centerY +
          rotatedY +
          positionY +
          deltaY +
          pitch * referenceBounds.height * headWeight
      };
    });
  }

  private buildLiveTargetPoints(
    current: FacePoint[],
    neutral: FacePoint[],
    videoFit: { left: number; top: number; width: number; height: number },
    controls: FaceRenderControls
  ) {
    const currentBounds = this.getNormalizedBounds(current);
    const neutralBounds = this.getNormalizedBounds(neutral);
    const neutralNose = neutral[1] ?? neutral[4];

    const points = current.map((currentPoint, index) => {
      const neutralPoint = neutral[index] ?? neutralNose;
      const neutralLocalX = (neutralPoint.x - neutralBounds.centerX) / neutralBounds.width;
      const neutralLocalY = (neutralPoint.y - neutralBounds.centerY) / neutralBounds.height;
      const rigidX = currentBounds.centerX + neutralLocalX * currentBounds.width;
      const rigidY = currentBounds.centerY + neutralLocalY * currentBounds.height;
      let strength = controls.headRotationStrength;

      if (mouthLandmarks.has(index)) {
        strength = controls.mouthStrength;
      } else if (eyeLandmarks.has(index)) {
        strength = controls.eyeStrength;
      } else if (jawLandmarks.has(index)) {
        strength = (controls.headRotationStrength + controls.mouthStrength) / 2;
      }

      const expressionStrength = ovalLandmarks.has(index)
        ? 1
        : clamp(strength * controls.motionStrength, 0.15, 1.35);
      const x = rigidX + (currentPoint.x - rigidX) * expressionStrength;
      const y = rigidY + (currentPoint.y - rigidY) * expressionStrength;

      return {
        x: videoFit.left + (1 - x) * videoFit.width,
        y: videoFit.top + y * videoFit.height
      };
    });

    const bounds = this.getBounds(faceOval.map((index) => points[index]).filter(Boolean));
    const positionX = controls.facePositionX * bounds.width;
    const positionY = controls.facePositionY * bounds.height;

    return points.map((point) => ({
      x: bounds.centerX + (point.x - bounds.centerX) * controls.faceScale + positionX,
      y: bounds.centerY + (point.y - bounds.centerY) * controls.faceScale + positionY
    }));
  }

  private drawLiveMouthDetails(
    outputContext: CanvasRenderingContext2D,
    detailContext: CanvasRenderingContext2D,
    detailMaskContext: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    videoFit: { left: number; top: number; width: number; height: number },
    targetPoints: Point[],
    width: number,
    height: number
  ) {
    this.drawMirroredVideo(detailContext, video, videoFit, width);
    detailMaskContext.save();
    detailMaskContext.filter = "blur(1.6px)";
    detailMaskContext.fillStyle = "#fff";
    this.traceFeature(detailMaskContext, targetPoints, mouthInterior, 1.08);
    detailMaskContext.fill();
    detailMaskContext.restore();

    detailContext.save();
    detailContext.globalCompositeOperation = "destination-in";
    detailContext.drawImage(this.detailMaskBuffer, 0, 0, width, height);
    detailContext.restore();
    outputContext.drawImage(this.detailBuffer, 0, 0, width, height);
  }

  private drawMirroredVideo(
    context: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    fit: { left: number; top: number; width: number; height: number },
    canvasWidth: number
  ) {
    context.save();
    context.translate(canvasWidth, 0);
    context.scale(-1, 1);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, fit.left, fit.top, fit.width, fit.height);
    context.restore();
  }

  private drawWarpedTriangle(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    source: [Point, Point, Point],
    target: [Point, Point, Point]
  ) {
    const [s0, s1, s2] = source;
    const [d0, d1, d2] = target;
    const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);

    if (Math.abs(denominator) < 0.0001) {
      return;
    }

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
    const e =
      (d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)) /
      denominator;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
    const f =
      (d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)) /
      denominator;

    context.save();
    context.beginPath();
    context.moveTo(d0.x, d0.y);
    context.lineTo(d1.x, d1.y);
    context.lineTo(d2.x, d2.y);
    context.closePath();
    context.clip();
    context.transform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
    context.restore();
  }

  private drawFeatheredMask(context: CanvasRenderingContext2D, points: Point[], feathering: number) {
    context.save();
    context.filter = `blur(${clamp(feathering, 0, 32)}px)`;
    context.fillStyle = "#fff";
    this.traceOval(context, points, 1);
    context.fill();
    context.restore();
  }

  private traceOval(context: CanvasRenderingContext2D, points: Point[], scale: number) {
    const ovalPoints = faceOval.map((index) => points[index]).filter(Boolean);
    const bounds = this.getBounds(ovalPoints);
    context.beginPath();

    ovalPoints.forEach((point, index) => {
      const x = bounds.centerX + (point.x - bounds.centerX) * scale;
      const y = bounds.centerY + (point.y - bounds.centerY) * scale;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
  }

  private traceFeature(
    context: CanvasRenderingContext2D,
    points: Point[],
    landmarkIndices: number[],
    scale: number
  ) {
    const featurePoints = landmarkIndices.map((index) => points[index]).filter(Boolean);
    const bounds = this.getBounds(featurePoints);
    context.beginPath();

    featurePoints.forEach((point, index) => {
      const x = bounds.centerX + (point.x - bounds.centerX) * scale;
      const y = bounds.centerY + (point.y - bounds.centerY) * scale;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
  }

  private expandTriangle(points: [Point, Point, Point], amount: number): [Point, Point, Point] {
    const centerX = (points[0].x + points[1].x + points[2].x) / 3;
    const centerY = (points[0].y + points[1].y + points[2].y) / 3;

    return points.map((point) => {
      const distance = Math.hypot(point.x - centerX, point.y - centerY) || 1;
      return {
        x: point.x + ((point.x - centerX) / distance) * amount,
        y: point.y + ((point.y - centerY) / distance) * amount
      };
    }) as [Point, Point, Point];
  }

  private getNormalizedBounds(points: FacePoint[]): Bounds {
    return this.getBounds(faceOval.map((index) => points[index]).filter(Boolean));
  }

  private getBounds(points: Point[]): Bounds {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: Math.max(0.0001, maxX - minX),
      height: Math.max(0.0001, maxY - minY)
    };
  }

  private getEyeAngle(points: FacePoint[]) {
    const left = points[33];
    const right = points[263];
    return left && right ? Math.atan2(right.y - left.y, right.x - left.x) : 0;
  }

  private measureReferenceLuminance(image: HTMLImageElement, landmarks: FacePoint[]) {
    if (landmarks.length === 0) {
      return 128;
    }

    const size = 256;
    this.sourceSampleBuffer.width = size;
    this.sourceSampleBuffer.height = size;
    const context = this.sourceSampleBuffer.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return 128;
    }

    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const points = skinSampleLandmarks
      .map((index) => landmarks[index])
      .filter(Boolean)
      .map((point) => ({ x: point.x * size, y: point.y * size }));

    return this.measurePointLuminance(context, points, 1);
  }

  private measureTargetLuminance(context: CanvasRenderingContext2D, points: Point[], pixelRatio: number) {
    const samples = skinSampleLandmarks.map((index) => points[index]).filter(Boolean);
    return this.measurePointLuminance(context, samples, pixelRatio);
  }

  private measurePointLuminance(context: CanvasRenderingContext2D, points: Point[], pixelRatio: number) {
    let luminance = 0;
    let samples = 0;

    try {
      for (const point of points) {
        const x = clamp(Math.round(point.x * pixelRatio), 1, context.canvas.width - 2);
        const y = clamp(Math.round(point.y * pixelRatio), 1, context.canvas.height - 2);
        const pixel = context.getImageData(x - 1, y - 1, 3, 3).data;

        for (let index = 0; index < pixel.length; index += 4) {
          luminance += pixel[index] * 0.2126 + pixel[index + 1] * 0.7152 + pixel[index + 2] * 0.0722;
          samples += 1;
        }
      }
    } catch {
      return 128;
    }

    return samples > 0 ? luminance / samples : 128;
  }

  private getImageFit(image: HTMLImageElement, width: number, height: number, fit: "cover" | "contain") {
    return this.getMediaFit(image.naturalWidth, image.naturalHeight, width, height, fit);
  }

  private getMediaFit(
    mediaWidth: number,
    mediaHeight: number,
    width: number,
    height: number,
    fit: "cover" | "contain"
  ) {
    const scale =
      fit === "contain"
        ? Math.min(width / mediaWidth, height / mediaHeight)
        : Math.max(width / mediaWidth, height / mediaHeight);
    const renderedWidth = mediaWidth * scale;
    const renderedHeight = mediaHeight * scale;

    return {
      left: (width - renderedWidth) / 2,
      top: (height - renderedHeight) / 2,
      width: renderedWidth,
      height: renderedHeight
    };
  }

  private resetContext(context: CanvasRenderingContext2D, pixelRatio: number, width: number, height: number) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.filter = "none";
  }

  private resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
}
