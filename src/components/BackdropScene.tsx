import { useEffect, useRef } from "react";

/**
 * Real 3D backdrop, on theme for a music app: glossy sound-wave strands —
 * tubes swept along animated waveforms, receding into depth — raymarched in a
 * single fragment shader behind the app's glass panels, so there are actual
 * lit objects with highlights and edges for the frosted panels to blur, which
 * is what a flat CSS gradient can never give you.
 *
 * Deliberately cheap, because this machine also runs real model inference and
 * the backdrop must never compete for the GPU:
 *  - renders at half resolution, upscaled by CSS
 *  - capped at 30fps, and stops entirely while the window is hidden
 *  - no dependencies, no textures, no post-processing, one draw call
 *  - renders a single static frame when the OS asks for reduced motion
 */

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform float u_dark;

out vec4 outColor;

const int STRAND_COUNT = 5;

// One strand's vertical displacement at a given x — a waveform built from a
// fundamental plus a harmonic, the way a real audio signal is. Each strand
// gets its own frequency, amplitude and speed so they drift out of phase and
// weave past each other instead of moving as one rigid block.
float strandY(float x, int i, float t) {
  float fi = float(i);
  float amp = 1.05 + 0.30 * sin(fi * 1.9);
  float freq = 0.40 + 0.15 * fi;
  float speed = 0.42 + 0.13 * fi;
  float phase = fi * 1.27;
  // Strands are spread apart vertically so they sweep across the whole
  // composition instead of bunching into one band through the middle.
  float baseline = 3.1 - fi * 1.55;
  // Amplitude swells toward the centre of the composition and tapers at the
  // edges, like a waveform envelope rather than an endless uniform ripple.
  float envelope = exp(-0.012 * x * x) * 0.78 + 0.22;
  return baseline
       + (sin(x * freq + t * speed + phase) * amp
        + sin(x * freq * 2.13 - t * speed * 0.71 + phase) * amp * 0.34) * envelope;
}

void strandAt(int i, out float depth, out float radius, out vec3 tint) {
  if (i == 0) {
    depth = -0.6; radius = 0.135; tint = vec3(0.42, 0.42, 0.97);   // indigo, nearest
  } else if (i == 1) {
    depth = -1.9; radius = 0.175; tint = vec3(0.64, 0.33, 0.97);   // violet
  } else if (i == 2) {
    depth = -3.2; radius = 0.215; tint = vec3(0.25, 0.71, 0.98);   // cyan
  } else if (i == 3) {
    depth = -4.6; radius = 0.225; tint = vec3(0.55, 0.30, 0.94);   // deep violet
  } else {
    depth = -6.1; radius = 0.270; tint = vec3(0.97, 0.58, 0.26);   // amber, furthest
  }
}

// Distance to a strand: a tube swept along x whose centreline rides the
// waveform. Exact for a straight tube; on a sloped stretch it overestimates,
// so the march below takes conservative fractional steps.
float strandDistance(vec3 p, int i, float t) {
  float depth; float radius; vec3 tint;
  strandAt(i, depth, radius, tint);
  float dy = p.y - strandY(p.x, i, t);
  float dz = p.z - depth;
  return length(vec2(dy, dz)) - radius;
}

float sceneDistance(vec3 p, out int nearest) {
  float best = 1e5;
  nearest = 0;
  for (int i = 0; i < STRAND_COUNT; i++) {
    float d = strandDistance(p, i, u_time);
    if (d < best) { best = d; nearest = i; }
  }
  return best;
}

float sceneDistanceOnly(vec3 p) {
  int ignored;
  return sceneDistance(p, ignored);
}

vec3 sceneNormal(vec3 p) {
  vec2 e = vec2(0.0022, 0.0);
  return normalize(vec3(
    sceneDistanceOnly(p + e.xyy) - sceneDistanceOnly(p - e.xyy),
    sceneDistanceOnly(p + e.yxy) - sceneDistanceOnly(p - e.yxy),
    sceneDistanceOnly(p + e.yyx) - sceneDistanceOnly(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  vec3 rayOrigin = vec3(0.0, 0.15, 7.0);
  vec3 rayDir = normalize(vec3(uv * 1.35, -1.9));

  float travelled = 0.0;
  bool hit = false;
  int strand = 0;
  vec3 position = rayOrigin;

  for (int step = 0; step < 96; step++) {
    position = rayOrigin + rayDir * travelled;
    int candidate;
    float d = sceneDistance(position, candidate);
    if (d < 0.0022) { hit = true; strand = candidate; break; }
    travelled += d * 0.62;
    if (travelled > 22.0) break;
  }

  if (!hit) {
    outColor = vec4(0.0);
    return;
  }

  float depth; float radius; vec3 baseColor;
  strandAt(strand, depth, radius, baseColor);

  vec3 normal = sceneNormal(position);
  vec3 viewDir = normalize(rayOrigin - position);

  vec3 keyDir = normalize(vec3(-0.40, 0.86, 0.72));
  vec3 fillDir = normalize(vec3(0.78, -0.30, 0.52));

  float key = max(dot(normal, keyDir), 0.0);
  float fill = max(dot(normal, fillDir), 0.0);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);

  // Tight blinn-phong highlight — the bright running specular down a
  // strand is what sells it as a lit, physical filament.
  vec3 halfDir = normalize(keyDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 74.0);

  vec3 color = baseColor * (0.24 + key * 0.80 + fill * 0.22);
  color += baseColor * fresnel * 0.80;
  color += vec3(1.0) * specular * 0.68;

  // Strands further back fade into the background, giving real aerial depth.
  float depthFade = clamp(1.0 - (-depth) / 11.0, 0.45, 1.0);

  // Light mode gets a softer, lifted rendition so dark UI text stays legible
  // over it; dark mode keeps the saturated, contrasty version.
  color = mix(color * 0.70 + vec3(0.20), color, u_dark);
  float alpha = (mix(0.50, 0.92, u_dark) + fresnel * 0.12) * depthFade;

  outColor = vec4(color, clamp(alpha, 0.0, 1.0));
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[BackdropScene] shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const TARGET_FRAME_MS = 1000 / 30;
const RESOLUTION_SCALE = 0.65;

export function BackdropScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    // No WebGL2 (rare, but a software-rendering or headless context can lack
    // it) simply means no backdrop art — never a broken app.
    if (!gl) return;

    const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[BackdropScene] program link failed:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One oversized triangle covering the viewport — cheaper than two.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLocation = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLocation);
    gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

    const resLocation = gl.getUniformLocation(program, "u_res");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const darkLocation = gl.getUniformLocation(program, "u_dark");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    function isDarkTheme(): boolean {
      const root = document.documentElement;
      if (root.classList.contains("dark")) return true;
      if (root.classList.contains("light")) return false;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function resize() {
      if (!canvas || !gl) return;
      const width = Math.max(1, Math.round(canvas.clientWidth * RESOLUTION_SCALE));
      const height = Math.max(1, Math.round(canvas.clientHeight * RESOLUTION_SCALE));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    function draw(timeSeconds: number) {
      if (!gl) return;
      resize();
      gl.uniform2f(resLocation, canvas!.width, canvas!.height);
      gl.uniform1f(timeLocation, timeSeconds);
      gl.uniform1f(darkLocation, isDarkTheme() ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      draw(0);
      return () => {
        gl.deleteProgram(program);
        gl.deleteBuffer(buffer);
      };
    }

    let frameId = 0;
    let lastFrame = 0;
    const startedAt = performance.now();

    function loop(now: number) {
      frameId = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - lastFrame < TARGET_FRAME_MS) return;
      lastFrame = now;
      draw((now - startedAt) / 1000);
    }
    frameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frameId);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <div className="kwesi-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} className="kwesi-backdrop-canvas" />
    </div>
  );
}
