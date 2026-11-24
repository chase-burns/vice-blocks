// mesh.js — where raw vertex data comes from. The interleaved layout
// used across the whole game is eleven floats per vertex:
//   xyz position | xyz normal | uv | rgb colour
// Two things are produced here. unitCubeData builds one tinted cube
// centred on the origin; every dynamic prop in the game is a scaled
// copy of it. Builder accumulates static scenery (buildings, roads,
// palms) into a single big buffer per material batch.

const FACES = [
  [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
  [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
  [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
];
const UV_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const WINDING = [0, 1, 2, 0, 2, 3];

export function unitCubeData(color) {
  const tint = color || [1, 1, 1];
  const out = [];
  for (const face of FACES) {
    const normal = face[0];
    const corners = face[1];
    for (const idx of WINDING) {
      out.push(corners[idx][0], corners[idx][1], corners[idx][2]);
      out.push(normal[0], normal[1], normal[2]);
      out.push(UV_CORNERS[idx][0], UV_CORNERS[idx][1]);
      out.push(tint[0], tint[1], tint[2]);
    }
  }
  return new Float32Array(out);
}

export class Builder {
  constructor() {
    this.data = [];
  }

  // One quad, emitted as two triangles. uvScale tiles the texture.
  quad(p1, p2, p3, p4, normal, color, uvScale) {
    const s = uvScale === undefined ? 1 : uvScale;
    const pts = [p1, p2, p3, p4];
    const uvs = [[0, 0], [s, 0], [s, s], [0, s]];
    for (const idx of WINDING) {
      const p = pts[idx];
      this.data.push(p[0], p[1], p[2], normal[0], normal[1], normal[2],
        uvs[idx][0], uvs[idx][1], color[0], color[1], color[2]);
    }
  }

  // Axis-aligned box placed by its footprint: cy is the floor the box
  // sits on, not its centre, because scenery is placed by footprint.
  box(cx, cy, cz, w, h, d, color, uvRepeat) {
    const r = uvRepeat || 0;
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy, y1 = cy + h;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, r);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color, r);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color, r);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color, r);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], color, 0);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, 0);
  }

  build(renderer) {
    return renderer.makeMesh(new Float32Array(this.data));
  }
}
