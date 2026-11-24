// mesh.js — a tiny geometry accumulator. The static city is baked once
// into a handful of big meshes (one per facade texture, one for roads,
// one for everything untextured) instead of thousands of draw calls.
// Boxes are centred on (x, z) with their base sitting at y; quads are
// arbitrary ground planes given as four corners. Every vertex carries a
// position, a normal, a tint colour and a uv pair, matching the scene
// shader's attribute layout.

const FACE_TABLE = [
  // [normal, [corner offsets as (sx, sy, sz) in unit-box space]]
  { n: [0, 0, 1], c: [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]] },   // front
  { n: [0, 0, -1], c: [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]] }, // back
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, -1], [1, 1, -1], [1, 1, 1]] },   // right
  { n: [-1, 0, 0], c: [[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]] }, // left
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },  // top
  { n: [0, -1, 0], c: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]] }, // bottom
];

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.tint = [];
    this.uv = [];
    this.count = 0;
  }

  _pushVert(x, y, z, n, color, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(n[0], n[1], n[2]);
    this.tint.push(color[0], color[1], color[2]);
    this.uv.push(u, v);
    this.count++;
  }

  // One box. The `rows` argument stretches the facade texture vertically
  // so tall towers get more window rows instead of stretched windows;
  // it only affects the four side faces.
  box(x, y, z, w, h, d, color, rows = 1) {
    const hw = w / 2, hd = d / 2;
    for (const face of FACE_TABLE) {
      const isSide = face.n[1] === 0;
      const vTop = isSide ? rows : 1;
      const quadUvs = [[0, 0], [1, 0], [1, vTop], [0, vTop]];
      const idx = [0, 1, 2, 0, 2, 3];
      const corners = face.c;
      for (const i of idx) {
        const c = corners[i];
        this._pushVert(
          x + c[0] * hw, y + c[1] * h, z + c[2] * hd,
          face.n, color, quadUvs[i][0], quadUvs[i][1],
        );
      }
    }
  }

  // A flat quad from four corners (used for road and water planes),
  // with uv scaled so the texture tiles every `tile` world units.
  quad(p1, p2, p3, p4, normal, color, tile = 1) {
    const pts = [p1, p2, p3, p4];
    const uvs = [[0, 0], [tile, 0], [tile, tile], [0, tile]];
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      const p = pts[i];
      this._pushVert(p[0], p[1], p[2], normal, color, uvs[i][0], uvs[i][1]);
    }
  }

  build(renderer) {
    return renderer.createMesh({
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.tint),
      uvs: new Float32Array(this.uv),
      count: this.count,
    });
  }
}
