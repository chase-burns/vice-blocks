// mesh.js — the source of all vertex data. Every vertex in the game
// uses one interleaved layout, eleven floats per vertex:
//   position xyz | normal xyz | uv | colour rgb
// unitCubeData emits a single tinted cube centred on the origin, which
// dynamic props scale and position at draw time. Builder gathers static
// scenery into one large buffer per material batch, so the whole city
// costs only a handful of draw calls.

const FACE_TABLE = [
  [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
  [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
  [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
];
const QUAD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRI_ORDER = [0, 1, 2, 0, 2, 3];

export function unitCubeData(color) {
  const rgb = color || [1, 1, 1];
  const verts = [];
  for (const [nrm, quad] of FACE_TABLE) {
    for (const k of TRI_ORDER) {
      verts.push(quad[k][0], quad[k][1], quad[k][2]);
      verts.push(nrm[0], nrm[1], nrm[2]);
      verts.push(QUAD_UV[k][0], QUAD_UV[k][1]);
      verts.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  return new Float32Array(verts);
}

export class Builder {
  constructor() { this.data = []; }

  // Append one quad as two triangles. uvScale controls how many times
  // the texture repeats across the face.
  quad(p1, p2, p3, p4, normal, color, uvScale) {
    const rep = uvScale === undefined ? 1 : uvScale;
    const pts = [p1, p2, p3, p4];
    const uvs = [[0, 0], [rep, 0], [rep, rep], [0, rep]];
    for (const k of TRI_ORDER) {
      const p = pts[k];
      this.data.push(p[0], p[1], p[2], normal[0], normal[1], normal[2],
        uvs[k][0], uvs[k][1], color[0], color[1], color[2]);
    }
  }

  // Axis-aligned box given its footprint; cy is the ground level the box
  // sits on, matching how the scenery code prefers to place things.
  box(cx, cy, cz, w, h, d, color, uvRepeat) {
    const rep = uvRepeat || 0;
    const xa = cx - w / 2, xb = cx + w / 2;
    const ya = cy, yb = cy + h;
    const za = cz - d / 2, zb = cz + d / 2;
    this.quad([xa, ya, zb], [xb, ya, zb], [xb, yb, zb], [xa, yb, zb], [0, 0, 1], color, rep);
    this.quad([xb, ya, za], [xa, ya, za], [xa, yb, za], [xb, yb, za], [0, 0, -1], color, rep);
    this.quad([xb, ya, zb], [xb, ya, za], [xb, yb, za], [xb, yb, zb], [1, 0, 0], color, rep);
    this.quad([xa, ya, za], [xa, ya, zb], [xa, yb, zb], [xa, yb, za], [-1, 0, 0], color, rep);
    this.quad([xa, yb, zb], [xb, yb, zb], [xb, yb, za], [xa, yb, za], [0, 1, 0], color, 0);
    this.quad([xa, ya, za], [xb, ya, za], [xb, ya, zb], [xa, ya, zb], [0, -1, 0], color, 0);
  }

  build(renderer) { return renderer.makeMesh(new Float32Array(this.data)); }
}
