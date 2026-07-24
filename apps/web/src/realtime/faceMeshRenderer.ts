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
  motionStrength: number;
  mouthStrength: number;
  eyeStrength: number;
  headRotationStrength: number;
  maskFeathering: number;
  faceScale: number;
  facePositionX: number;
  facePositionY: number;
  fit: "cover" | "contain";
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
  private referenceImage: HTMLImageElement | null = null;
  private referenceLandmarks: FacePoint[] | null = null;
  private triangles: FaceTriangle[] = [];

  setReference(image: HTMLImageElement, landmarks: FacePoint[], triangles: FaceTriangle[]) {
    this.referenceImage = image;
    this.referenceLandmarks = landmarks.map((point) => ({ ...point }));
    this.triangles = triangles;
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
    controls: FaceRenderControls
  ) {
    const image = this.referenceImage;
    const reference = this.referenceLandmarks;
    const cssWidth = Math.max(1, Math.round(output.clientWidth || 960));
    const cssHeight = Math.max(1, Math.round(output.clientHeight || 540));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);

    this.resizeCanvas(output, pixelWidth, pixelHeight);
    this.resizeCanvas(this.faceBuffer, pixelWidth, pixelHeight);
    this.resizeCanvas(this.maskBuffer, pixelWidth, pixelHeight);

    const outputContext = output.getContext("2d");
    const faceContext = this.faceBuffer.getContext("2d");
    const maskContext = this.maskBuffer.getContext("2d");

    if (!outputContext || !faceContext || !maskContext) {
      return;
    }

    this.resetContext(outputContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(faceContext, pixelRatio, cssWidth, cssHeight);
    this.resetContext(maskContext, pixelRatio, cssWidth, cssHeight);

    if (!image) {
      return;
    }

    const fit = this.getImageFit(image, cssWidth, cssHeight, controls.fit);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(image, fit.left, fit.top, fit.width, fit.height);

    if (
      !reference ||
      !currentLandmarks ||
      !neutralLandmarks ||
      this.triangles.length === 0 ||
      currentLandmarks.length !== neutralLandmarks.length
    ) {
      return;
    }

    const sourcePoints = reference.map((point) => ({
      x: fit.left + point.x * fit.width,
      y: fit.top + point.y * fit.height
    }));
    const targetPoints = this.buildTargetPoints(sourcePoints, currentLandmarks, neutralLandmarks, controls);
    const sourceImagePoints = reference.map((point) => ({
      x: point.x * image.naturalWidth,
      y: point.y * image.naturalHeight
    }));

    faceContext.imageSmoothingEnabled = true;
    faceContext.imageSmoothingQuality = "high";

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
  }

  private buildTargetPoints(
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

  private getImageFit(image: HTMLImageElement, width: number, height: number, fit: "cover" | "contain") {
    const scale =
      fit === "contain"
        ? Math.min(width / image.naturalWidth, height / image.naturalHeight)
        : Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;

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
