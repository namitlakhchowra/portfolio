(() => {
  const cover = document.querySelector('.cover');
  const art = cover.querySelector('.cover-art');
  const canvas = art.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const surfaces = [cover, ...document.querySelectorAll('main section')];
  const edges = surfaces.map((section, seed) => {
    const edge = document.createElement('canvas');
    edge.className = 'pixel-edge';
    edge.setAttribute('aria-hidden', 'true');
    section.append(edge);
    return { edge, ctx: edge.getContext('2d'), section, seed };
  });
  // Use a stable cell pattern so reversing scroll retraces the same contour.
  function noise(column, row, seed) {
    const value = Math.sin(column * 73.13 + row * 37.71 + seed * 19.53) * 43758.5453;
    return value - Math.floor(value);
  }

  function drawEdges() {
    const width = document.documentElement.clientWidth;
    for (const { edge, ctx, section, seed } of edges) {
      if (!ctx) continue;
      const size = Math.max(7, Math.min(seed === 0 ? 21 : 13, Math.round(width / 80)));
      const height = size * (seed === 0 ? 7 : 4);
      if (edge.width !== width || edge.height !== height) {
        edge.width = width;
        edge.height = height;
        edge.style.setProperty('--edge-height', height + 'px');
      }
      const y = edge.getBoundingClientRect().bottom;
      if (y < 0 || y - height > innerHeight) continue;
      const progress = reduced.matches ? .5 : Math.max(0, Math.min(1, 1 - y / innerHeight));
      const style = getComputedStyle(section);
      ctx.fillStyle = style.getPropertyValue(seed === 0 ? '--bg' : '--surface').trim();
      ctx.clearRect(0, 0, width, height);
      for (let col = 0; col * size < width; col++) {
        const profile = noise(col, 0, seed) * .65 + noise(Math.floor(col / 3), 1, seed) * .35;
        const rows = 1 + Math.floor(profile * (height / size - 1) * (.47 + .53 * progress));
        const top = height - rows * size;
        ctx.fillRect(col * size, top, size, rows * size);
        if (rows > 2 && noise(col, 2, seed) > .84) ctx.clearRect(col * size, top + size, size, size);
      }
    }
  }

  // The same trefoil, tube radius, starting pose and studio lighting as the cover still.
  function createKnotRenderer() {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) return null;
    const vertex = `
      attribute vec2 angles;
      uniform float turn;
      varying vec3 normal;
      vec3 curve(float t) {
        float r = 1.68 + .72 * cos(3. * t);
        return vec3(r * cos(2.*t), r * sin(2.*t), .88 * sin(3.*t));
      }
      vec3 pose(vec3 p) {
        float c=cos(.42), s=sin(.42);
        p.xy=mat2(c,-s,s,c)*p.xy;
        c=cos(.74); s=sin(.74); p.yz=mat2(c,-s,s,c)*p.yz;
        c=cos(turn); s=sin(turn); p.xz=mat2(c,-s,s,c)*p.xz;
        return p;
      }
      void main() {
        float t=angles.x, a=angles.y;
        vec3 tangent=normalize(curve(t+.001)-curve(t-.001));
        vec3 u=normalize(cross(tangent,vec3(0.,0.,1.)));
        vec3 n=u*cos(a)+cross(tangent,u)*sin(a);
        vec3 p=pose(curve(t)+.48*n);
        normal=pose(n);
        gl_Position=vec4((p.xy-vec2(.050,-.027))* .3575,-p.z*.25,1.);
      }`;
    const fragment = `
      precision mediump float;
      varying vec3 normal;
      float strip(float x,float w) {return exp(-pow(min(abs(x)/w,3.),4.));}
      void main() {
        vec3 ray=reflect(vec3(0.,0.,-1.),normalize(normal));
        float lat=ray.y, lon=atan(ray.x,ray.z);
        float light=.068+.47*max(0.,lat)+.65*strip(lat-.13*sin(1.6*lon)-.29,.14)
                   +.48*strip(lon+1.6,.56)+.30*strip(lat+.56,.09);
        gl_FragColor=vec4(light*vec3(.88,.95,1.05)+vec3(.012,.017,.031),1.);
      }`;
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const angles = [], triangles = [];
    const rings = 192, sides = 32;
    for (let ring = 0; ring <= rings; ring++) {
      for (let side = 0; side <= sides; side++) {
        angles.push(ring / rings * 2 * Math.PI, side / sides * 2 * Math.PI);
        if (ring < rings && side < sides) {
          const i = ring * (sides + 1) + side, j = i + sides + 1;
          triangles.push(i, j, i + 1, j, j + 1, i + 1);
        }
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(angles), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'angles');
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(location);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(triangles), gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    const turn = gl.getUniformLocation(program, 'turn');
    return angle => {
      const size = Math.max(1, Math.round(art.clientWidth * Math.min(devicePixelRatio, 2)));
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = canvas.height = size;
        gl.viewport(0, 0, size, size);
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(turn, angle);
      gl.drawElements(gl.TRIANGLES, triangles.length, gl.UNSIGNED_SHORT, 0);
    };
  }

  let renderKnot, scheduled = false;
  function paint() {
    scheduled = false;
    drawEdges();
    const height = cover.offsetHeight;
    if (scrollY > height) return;
    const travel = reduced.matches ? 0 : Math.max(0, Math.min(1, scrollY / height));
    art.style.setProperty('--drift', height * travel * .34 + 'px');
    art.style.setProperty('--fallback-turn', travel * 150 + 'deg');
    if (travel === 0) {
      art.classList.remove('has-mesh');
      return;
    }
    if (renderKnot === undefined) renderKnot = createKnotRenderer();
    if (renderKnot) {
      renderKnot(travel * Math.PI * 1.5);
      art.classList.add('has-mesh');
    }
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(paint);
    }
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderKnot = null;
    art.classList.remove('has-mesh');
  });
  canvas.addEventListener('webglcontextrestored', () => { renderKnot = undefined; schedule(); });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  reduced.addEventListener('change', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(schedule).observe(document.querySelector('main'));
  paint();
})();
