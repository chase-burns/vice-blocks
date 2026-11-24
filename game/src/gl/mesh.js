// Procedural mesh synthesis (WO Task 3): interleaved pos/norm/uv/color buffers,
// static-world Builder, unit cube, and small part builders for cars/people.
export function unitCubeData(color = [1, 1, 1]) {
  const F = [
    [[0,0,1], [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]]],
    [[0,0,-1], [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]]],
    [[1,0,0], [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]]],
    [[-1,0,0], [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]]],
    [[0,1,0], [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]]],
    [[0,-1,0], [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]]],
  ];
  const out = [];
  const uv = [[0,0],[1,0],[1,1],[0,1]];
  for (const [n, cs] of F) {
    const idx = [0,1,2, 0,2,3];
    for (const i of idx) out.push(...cs[i], ...n, ...uv[i], ...color);
  }
  return new Float32Array(out);
}

export class Builder {
  constructor() { this.data = []; }
  quad(p1, p2, p3, p4, n, color, uvScale = 1) {
    const uv = [[0,0],[uvScale,0],[uvScale,uvScale],[0,uvScale]];
    const pts = [p1,p2,p3, p1,p3,p4];
    const uvs = [uv[0],uv[1],uv[2], uv[0],uv[2],uv[3]];
    for (let i = 0; i < 6; i++) this.data.push(...pts[i], ...n, ...uvs[i], ...color);
  }
  box(cx, cy, cz, w, h, d, color, uvRepeat = 0) {
    const x0 = cx-w/2, x1 = cx+w/2, y0 = cy, y1 = cy+h, z0 = cz-d/2, z1 = cz+d/2;
    const r = uvRepeat;
    this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],color,r);
    this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1],color,r);
    this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0],color,r);
    this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],color,r);
    this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0],color,0);
    this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],color,0);
  }
  build(r) { return r.makeMesh(new Float32Array(this.data)); }
}
