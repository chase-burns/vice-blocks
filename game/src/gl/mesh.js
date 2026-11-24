// mesh.js — vertex data factory. Every vertex in the game is interleaved as
// [position xyz | normal xyz | uv | colour rgb] (11 floats), which is the
// layout the renderer binds. Two producers live here: unitCubeData, the
// single tinted cube that all dynamic props are scaled from, and Builder,
// which accumulates static world geometry (buildings, roads, palms) into
// one big buffer per material batch.

// The six faces of a unit cube centred on the origin, each as
// [outward normal, four corners in winding order].
const CUBE_FACES = [
  [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
  [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
  [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
];
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRI_ORDER = [0, 1, 2, 0, 2, 3];

export function unitCubeData(color = [1, 1, 1]) {
  const verts = [];
  for (const [normal, corners] of CUBE_FACES) {
    for (const ci of TRI_ORDER) {
      verts.push(...corners[ci], ...normal, ...CORNER_UV[ci], ...color);
    }
  }
  return new Float32Array(verts);
}

export class Builder {
  constructor() {
    this.data = [];
  }

  // Append one quad as two triangles. uvScale tiles the texture across it.
  quad(p1, p2, p3, p4, normal, color, uvScale = 1) {
    const s = uvScale;
    const corners = [p1, p2, p3, p4];
    const uvs = [[0, 0], [s, 0], [s, s], [0, s]];
    for (const ci of TRI_ORDER) {
      this.data.push(...corners[ci], ...normal, ...uvs[ci], ...color);
    }
  }

  // Append an axis-aligned box whose base sits at cy (so cy is the floor,
  // not the centre — buildings and props are placed by their footprint).
  box(cx, cy, cz, w, h, d, color, uvRepeat = 0) {
    const xa = cx - w / 2, xb = cx + w / 2;
    const ya = cy, yb = cy + h;
    const za = cz - d / 2, zb = cz + d / 2;
    const r = uvRepeat;
    this.quad([xa, ya, zb], [xb, ya, zb], [xb, yb, zb], [xa, yb, zb], [0, 0, 1], color, r);
    this.quad([xb, ya, za], [xa, ya, za], [xa, yb, za], [xb, yb, za], [0, 0, -1], color, r);
    this.quad([xb, ya, zb], [xb, ya, za], [xb, yb, za], [xb, yb, zb], [1, 0, 0], color, r);
    this.quad([xa, ya, za], [xa, ya, zb], [xa, yb, zb], [xa, yb, za], [-1, 0, 0], color, r);
    this.quad([xa, yb, zb], [xb, yb, zb], [xb, yb, za], [xa, yb, za], [0, 1, 0], color, 0);
    this.quad([xa, ya, za], [xb, ya, za], [xb, ya, zb], [xa, ya, zb], [0, -1, 0], color, 0);
  }

  build(renderer) {
    return renderer.makeMesh(new Float32Array(this.data));
  }
}
