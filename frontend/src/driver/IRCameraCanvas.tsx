import { useEffect, useRef, useState } from "react";

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`;

export const MONOCHROME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 fragColor;

float noise(vec2 point) {
  return fract(sin(dot(floor(point * 1024.0), vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 source = texture(u_texture, uv).rgb;
  float luma = dot(source, vec3(0.2126, 0.7152, 0.0722));
  luma = smoothstep(0.04, 0.96, luma);
  luma = pow(luma, 0.88);
  luma += (noise(uv) - 0.5) * 0.018;

  vec2 lens = uv * 2.0 - 1.0;
  luma *= 1.0 - dot(lens, lens) * 0.10;
  luma = clamp(luma, 0.0, 1.0);

  fragColor = vec4(vec3(luma), 1.0);
}`;

interface IRCameraCanvasProps {
  src: string;
  alt: string;
  continuous?: boolean;
  className?: string;
  onError?: () => void;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function IRCameraCanvas({
  src,
  alt,
  continuous = false,
  className = "",
  onError,
}: IRCameraCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const [contextGeneration, setContextGeneration] = useState(0);

  useEffect(() => {
    setFallback(false);
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fallback) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
      desynchronized: true,
    });
    if (!gl || gl.isContextLost()) {
      setFallback(true);
      return;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      MONOCHROME_FRAGMENT_SHADER,
    );
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      setFallback(true);
      return;
    }

    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    if (!program || !buffer || !texture) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      setFallback(true);
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      setFallback(true);
      return;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const image = new Image();
    image.crossOrigin = "anonymous";
    let animationFrame = 0;
    let visible = true;
    let disposed = false;

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const draw = () => {
      animationFrame = 0;
      if (
        disposed ||
        !visible ||
        document.hidden ||
        gl.isContextLost() ||
        image.naturalWidth === 0
      ) {
        return;
      }

      if (
        canvas.width !== image.naturalWidth ||
        canvas.height !== image.naturalHeight
      ) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (continuous) animationFrame = requestAnimationFrame(draw);
    };

    const wake = () => {
      stop();
      if (visible && !document.hidden && image.naturalWidth > 0) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else wake();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
    };
    const onContextRestored = () => {
      setContextGeneration((generation) => generation + 1);
    };

    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) wake();
      else stop();
    });
    intersectionObserver.observe(canvas);

    image.onload = wake;
    image.onerror = () => {
      setFallback(true);
      onError?.();
    };
    image.src = src;

    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      disposed = true;
      stop();
      image.onload = null;
      image.onerror = null;
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      }
    };
  }, [src, continuous, fallback, contextGeneration, onError]);

  if (fallback) {
    return (
      <img
        className={`camera-feed monochrome-camera-fallback ${className}`}
        src={src}
        alt={alt}
        onError={onError}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`camera-feed monochrome-camera-canvas ${className}`}
      role="img"
      aria-label={alt}
      data-src={src}
    />
  );
}
