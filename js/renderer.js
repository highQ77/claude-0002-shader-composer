'use strict';
/* =========================================================================
 * WebGL2 渲染器：網格、攝影機矩陣、shader program 快取、貼圖
 * ========================================================================= */

/* ---------------- mat4（column-major） ---------------- */
const Mat4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, center, up) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(eye, center)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
};

/* ---------------- 網格（交錯格式：pos3 normal3 uv2） ---------------- */
/** 產生 (n+1)×(n+1) 頂點的格狀網格；fn(u, v) 回傳 [x,y,z, nx,ny,nz] */
function gridMesh(n, fn, verts = [], idx = []) {
  const base = verts.length / 8;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    verts.push(...fn(u, v), u, v);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = base + j * (n + 1) + i, b = a + n + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { verts, idx };
}

const MESHES = {
  quad() {
    return {
      verts: [-1, -1, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, -1, 1, 0, 0, 0, 1, 0, 1],
      idx: [0, 1, 2, 0, 2, 3],
    };
  },
  plane() {
    return gridMesh(160, (u, v) => [u * 2 - 1, 0, 1 - v * 2, 0, 1, 0]);
  },
  sphere(seg = 96, rings = 64) {
    const verts = [], idx = [];
    for (let y = 0; y <= rings; y++) for (let x = 0; x <= seg; x++) {
      const u = x / seg, v = y / rings, th = u * Math.PI * 2, ph = v * Math.PI;
      const nx = -Math.cos(th) * Math.sin(ph), ny = Math.cos(ph), nz = Math.sin(th) * Math.sin(ph);
      verts.push(nx, ny, nz, nx, ny, nz, u, 1 - v);
    }
    for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { verts, idx };
  },
  cube() {
    const verts = [], idx = [], s = 0.75;
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, a, b] of faces) {
      gridMesh(32, (u, v) => {
        const x = u * 2 - 1, y = v * 2 - 1;
        return [(n[0] + a[0] * x + b[0] * y) * s, (n[1] + a[1] * x + b[1] * y) * s, (n[2] + a[2] * x + b[2] * y) * s, ...n];
      }, verts, idx);
    }
    return { verts, idx };
  },
  torus(seg = 128, sides = 48, R = 0.72, r = 0.32) {
    const verts = [], idx = [];
    for (let i = 0; i <= seg; i++) for (let j = 0; j <= sides; j++) {
      const u = i / seg * Math.PI * 2, v = j / sides * Math.PI * 2;
      const nx = Math.cos(v) * Math.cos(u), ny = Math.sin(v), nz = Math.cos(v) * Math.sin(u);
      verts.push(Math.cos(u) * R + nx * r, ny * r, Math.sin(u) * R + nz * r, nx, ny, nz, i / seg, j / sides);
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { verts, idx };
  },
};

/* ---------------- 內建貼圖：UV 測試格線 ---------------- */
let _uvGrid = null;
function builtinUVGrid() {
  if (_uvGrid) return _uvGrid;
  const N = 512, cells = 8, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), s = N / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const hue = (x / cells) * 300, light = 38 + (y / cells) * 30 + ((x + y) % 2) * 8;
    g.fillStyle = `hsl(${hue}, 70%, ${light}%)`;
    g.fillRect(x * s, y * s, s, s);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = `bold ${s * 0.3}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String.fromCharCode(65 + x) + (cells - y), x * s + s / 2, y * s + s / 2);
  }
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, N); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(N, i * s); g.stroke();
  }
  return (_uvGrid = c);
}

class GLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
    this.gl = gl;
    this.canvas = canvas;
    this.cache = new Map();
    this.meshes = {};
    this.textures = new Map();
  }

  _shader(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      return { error: log };
    }
    return { shader: s };
  }

  _mesh(name) {
    if (this.meshes[name]) return this.meshes[name];
    const gl = this.gl, m = MESHES[name]();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.verts), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.idx), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
    return (this.meshes[name] = { vao, count: m.idx.length });
  }

  /** 取得（或編譯）program；src = { vs, fs }；回傳 { prog, ... } 或 { error } */
  program(src) {
    const gl = this.gl, key = src.vs + '\n/*--*/\n' + src.fs;
    if (this.cache.has(key)) {
      const e = this.cache.get(key);
      this.cache.delete(key); this.cache.set(key, e); // LRU
      return e;
    }
    let entry;
    const vs = this._shader(gl.VERTEX_SHADER, src.vs);
    const fs = vs.error ? null : this._shader(gl.FRAGMENT_SHADER, src.fs);
    if (vs.error) entry = { error: 'Vertex shader：\n' + vs.error };
    else if (fs.error) { entry = { error: 'Fragment shader：\n' + fs.error }; gl.deleteShader(vs.shader); }
    else {
      const p = gl.createProgram();
      gl.attachShader(p, vs.shader);
      gl.attachShader(p, fs.shader);
      gl.linkProgram(p);
      gl.deleteShader(vs.shader);
      gl.deleteShader(fs.shader);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        entry = { error: 'Link：\n' + gl.getProgramInfoLog(p) };
        gl.deleteProgram(p);
      } else {
        entry = { prog: p, locs: {} };
      }
    }
    this.cache.set(key, entry);
    while (this.cache.size > 160) {
      const [k, old] = this.cache.entries().next().value;
      if (old.prog) { gl.deleteProgram(old.prog); old.deleted = true; }
      this.cache.delete(k);
    }
    return entry;
  }

  _loc(entry, name) {
    if (!(name in entry.locs)) entry.locs[name] = this.gl.getUniformLocation(entry.prog, name);
    return entry.locs[name];
  }

  /** url 為空字串時使用內建 UV 格線；圖片載入前先用灰色 1×1 佔位 */
  _texture(url, wrap) {
    const key = (url || 'builtin') + '|' + wrap;
    const hit = this.textures.get(key);
    if (hit) return hit;
    const gl = this.gl, tex = gl.createTexture();
    this.textures.set(key, tex);
    const mode = { clamp: gl.CLAMP_TO_EDGE, mirror: gl.MIRRORED_REPEAT }[wrap] || gl.REPEAT;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const upload = img => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    };
    if (!url) upload(builtinUVGrid());
    else {
      const img = new Image();
      img.onload = () => upload(img);
      img.src = url;
    }
    return tex;
  }

  clear() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** o: { w, h, mesh, viewProj, model, camPos, lightDir, time, mouse, aspect, textures: [{uniform, url, wrap}] } */
  draw(entry, o) {
    if (!entry || !entry.prog || entry.deleted) return;
    const gl = this.gl;
    gl.viewport(0, 0, o.w, o.h);
    this.clear();
    if (o.mesh === 'quad') gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    gl.useProgram(entry.prog);
    gl.uniformMatrix4fv(this._loc(entry, 'u_viewProj'), false, o.viewProj);
    gl.uniformMatrix4fv(this._loc(entry, 'u_model'), false, o.model);
    gl.uniform1f(this._loc(entry, 'u_time'), o.time);
    gl.uniform2f(this._loc(entry, 'u_resolution'), o.w, o.h);
    gl.uniform2f(this._loc(entry, 'u_mouse'), o.mouse[0], o.mouse[1]);
    gl.uniform1f(this._loc(entry, 'u_aspect'), o.aspect);
    gl.uniform3fv(this._loc(entry, 'u_camPos'), o.camPos);
    gl.uniform3fv(this._loc(entry, 'u_lightDir'), o.lightDir);
    (o.textures || []).forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this._texture(t.url, t.wrap));
      gl.uniform1i(this._loc(entry, t.uniform), i);
    });
    const m = this._mesh(o.mesh);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}
