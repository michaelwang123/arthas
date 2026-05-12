/**
 * 虚空背景着色器
 * 用 GLSL 生成流动的暗紫色星云效果，零带宽消耗
 */
export const voidBackgroundFragment = `
  precision mediump float;

  varying vec2 vTextureCoord;
  uniform float uTime;
  uniform vec2 uResolution;

  // 简单噪声函数
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vTextureCoord;
    float t = uTime * 0.02;

    // 多层噪声叠加
    float n1 = fbm(uv * 3.0 + vec2(t * 0.3, t * 0.1));
    float n2 = fbm(uv * 5.0 - vec2(t * 0.2, t * 0.4));
    float n3 = fbm(uv * 8.0 + vec2(t * 0.1, -t * 0.2));

    // 暗紫色虚空基调
    vec3 color = vec3(0.05, 0.03, 0.1);

    // 紫色星云
    color += vec3(0.15, 0.05, 0.25) * n1;

    // 深蓝色气流
    color += vec3(0.02, 0.05, 0.15) * n2;

    // 微弱的亮点（星星）
    float stars = step(0.97, hash(floor(uv * 200.0)));
    color += vec3(0.8, 0.7, 1.0) * stars * (0.5 + 0.5 * sin(t * 10.0 + hash(floor(uv * 200.0)) * 6.28));

    // 中心微弱光晕（源石能量）
    float dist = length(uv - 0.5);
    color += vec3(0.1, 0.02, 0.2) * (1.0 - smoothstep(0.0, 0.5, dist)) * (0.3 + 0.1 * sin(t * 3.0));

    // 暗角
    color *= 1.0 - 0.3 * dist;

    gl_FragColor = vec4(color, 1.0);
  }
`

export const voidBackgroundVertex = `
  attribute vec2 aVertexPosition;
  attribute vec2 aTextureCoord;

  uniform mat3 projectionMatrix;

  varying vec2 vTextureCoord;

  void main() {
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
  }
`
