// mesh.js — vertex data production. Every vertex in the game shares an
// eleven-float interleaved layout:
//   position xyz | normal xyz | uv | colour rgb
// unitCubeData emits a single tinted cube about the origin; dynamic props
// are scaled copies of it. Builder gathers static scenery into one large
// buffer per material batch so the city draws in few calls.

const FACE_DEFS = [
  [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
  [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
  [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
];
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRI_ORDER = [0, 1, 2, 0, 2, 3];

export function unitCubeData(color) {
  const tint = color || [1, 1, 1];
  const floats = [];
  for (const [normal, corners] of FACE_DEFS) {
    for (const k of TRI_ORDER) {
      floats.push(corners[k][0], corners[k][1], corners[k][2]);
      floats.push(normal[0], normal[1], normal[2]);
      floats.push(CORNER_UV[k][0], CORNER_UV[k][1]);
      floats.push(tint[0], tint[1], tint[2]);
    }
  }
  return new Float32Array(floats);
}

export class Builder {
  constructor() { this.data = []; }

  // Append one quad as two triangles; uvScale controls texture tiling.
  quad(p1, p2, p3, p4, normal, color, uvScale) {
    const s = uvScale === undefined ? 1 : uvScale;
    const pts = [p1, p2, p3, p4];
    const uvs = [[0, 0], [s, 0], [s, s], [0, s]];
    for (const k of TRI_ORDER) {
      const p = pts[k];
      this.data.push(p[0], p[1], p[2], normal[0], normal[1], normal[2],
        uvs[k][0], uvs[k][1], color[0], color[1], color[2]);
    }
  }

  // Axis-aligned box described by footprint: cy is the floor it rests on,
  // which is how scenery placement thinks about buildings and props.
  box(cx, cy, cz, w, h, d, color, uvRepeat) {
    const r = uvRepeat || 0;
    const xa = cx - w / 2, xb = cx + w / 2;
    const ya = cy, yb = cy + h;
    const za = cz - d / 2, zb = cz + d / 2;
    this.quad([xa, ya, zb], [xb, ya, zb], [xb, yb, zb], [xa, yb, zb], [0, 0, 1], color, r);
    this.quad([xb, ya, za], [xa, ya, za], [xa, yb, za], [xb, yb, za], [0, 0, -1], color, r);
    this.quad([xb, ya, zb], [xb, ya, za], [xb, yb, za], [xb, yb, zb], [1, 0, 0], color, r);
    this.quad([xa, ya, za], [xa, ya, zb], [xa, yb, zb], [xa, yb, za], [-1, 0, 0], color, r);
    this.quad([xa, yb, zb], [xb, yb, zb], [xb, yb, za], [xa, yb, za], [0, 1, 0], color, 0);
    this.quad([xa, ya, za], [xb, ya, za], [xb, ya, zb], [xa, ya, zb], [0, -1, 0], color, 0);
  }

  build(renderer) { return renderer.makeMesh(new Float32Array(this.data)); }
}
