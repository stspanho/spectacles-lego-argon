// BrickDust - instanced mini DUPLO bricks as particles (LS 5.15 Code Node, ONE draw call per layer).
// Every instance is derived statelessly from its id + the clock (spectacles-gpu-particles pattern).
// dustA = (radius cm, progress 0..1, mode, sizeMul)    mode 0: scan cloud | 1: burst | 2: converge
// dustB = (seed, fade 0..1, lift cm, spin)
// The layer object sits at identity at the scene root, so object space == world space.
input_vec3 centreW;
input_vec4 dustA;
input_vec4 dustB;
input_color4 colA;
input_color4 colB;
input_color4 colC;
input_color4 colD;
output_vec3 transformedPosition;
output_vec4 vertexColor;

// Hoskins hash - no sin(), FP16 safe
float hash(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

vec3 rotQ(vec4 q, vec3 p) { vec3 t = cross(q.xyz, p) + q.w * p; return p + 2.0 * cross(q.xyz, t); }

void main() {
    float id = float(system.getInstanceID());
    float time = mod(system.getTimeElapsed(), 256.0);
    float R = dustA.x;
    float progress = dustA.y;
    float mode = dustA.z;
    float sizeMul = dustA.w;
    float seed = dustB.x;
    float fade = dustB.y;
    float lift = dustB.z;
    float spin = dustB.w;

    float h1 = hash(id + seed);
    float h2 = hash(id + 13.0 + seed);
    float h3 = hash(id + 31.0 + seed);
    float h4 = hash(id + 47.0 + seed);
    float r5 = fract(h1 * 7.71 + 0.137);
    float az = h1 * 6.2831853;

    vec3 pos = centreW;
    float scl = 0.0;
    float glow = 0.0;
    if (mode < 0.5) {
        // scan cloud: a sunflower disc of bricks lying on the table; waves roll outward and the
        // bricks hop and brighten as a front passes
        float r = R * sqrt(h2);
        float a = az + time * 0.15 * (h3 - 0.5);
        float ph = (time * 18.0 - r) / 11.0;
        float w = cos(6.2831853 * fract(ph));
        w = w > 0.0 ? pow(w, 6.0) : 0.0;
        float hop = w * lift * (0.5 + 0.5 * h4);
        pos = centreW + vec3(cos(a) * r, 0.3 + hop, sin(a) * r);
        float edge = 1.0 - (r / R) * (r / R);
        scl = sizeMul * (0.35 + 0.9 * w) * edge;
        glow = w;
    } else if (mode < 1.5) {
        // burst: a fountain of bricks, ballistic, staggered starts
        float stagger = 0.3;
        float pStart = r5 * stagger;
        float pLocal = clamp((progress - pStart) / (1.0 - stagger), 0.0, 1.0);
        float cosPhi = 0.35 + 0.65 * h2;
        float sinPhi = sqrt(1.0 - cosPhi * cosPhi);
        vec3 dir = vec3(cos(az) * sinPhi, cosPhi, sin(az) * sinPhi);
        float t1 = 1.0 - pLocal;
        float t3 = t1 * t1 * t1;
        float pEase = 1.0 - (t3 + t3 * t1) * 0.5;
        float rr = pEase * R * (0.5 + 0.5 * h4);
        float y = dir.y * sin(pLocal * 3.1415926) * lift - lift * 0.7 * pLocal * pLocal;
        pos = centreW + vec3(dir.x * rr, y, dir.z * rr);
        float late = 1.0 - smoothstep(0.6, 1.0, pLocal);
        scl = sizeMul * smoothstep(0.0, 0.08, pLocal) * late;
        glow = 1.0 - pLocal;
    } else {
        // converge: spiral inward onto the centre and shrink ("found it" pop)
        float p = clamp((progress - r5 * 0.25) / 0.75, 0.0, 1.0);
        float pe = 1.0 - (1.0 - p) * (1.0 - p);
        float r = R * (1.0 - pe);
        float a = az + pe * 2.5;
        pos = centreW + vec3(cos(a) * r, 0.5 + lift * sin(pe * 3.1415926) * (0.3 + 0.7 * h3), sin(a) * r);
        scl = sizeMul * (1.0 - pe * 0.85) * smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.9, 1.0, p));
        glow = pe;
    }
    scl *= fade;

    // tumble
    vec3 axis = normalize(vec3(h2 - 0.5, h3 - 0.5, h4 - 0.5) + vec3(0.001, 0.0, 0.0));
    float ang = mod(h1 * 6.2831853 + time * spin * (0.5 + h3), 6.2831853);
    vec4 q = vec4(axis * sin(ang * 0.5), cos(ang * 0.5));
    vec3 lp = rotQ(q, system.getSurfacePositionObjectSpace() * scl);
    vec3 nrm = normalize(rotQ(q, system.getSurfaceNormalObjectSpace()));
    transformedPosition = pos + lp;

    // 4-way LEGO palette per instance, fake-lit by the tumbled normal
    float c = hash(id + 71.0 + seed) * 4.0;
    vec3 col = c < 1.0 ? colA.rgb : (c < 2.0 ? colB.rgb : (c < 3.0 ? colC.rgb : colD.rgb));
    vec3 L = normalize(vec3(0.35, 1.0, 0.45));
    float light = 0.5 + 0.5 * max(0.0, dot(nrm, L));
    vec3 rgb = col * light + col * glow * 0.6 + vec3(glow * 0.15);
    vertexColor = vec4(rgb, 1.0);
}
