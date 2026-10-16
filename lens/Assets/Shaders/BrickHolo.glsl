// BrickHolo - hologram / solid brick shading for the Brick Builder lens (LS 5.15 Code Node).
// ghost = 1: translucent hologram with a fresnel rim and a scanline sweeping upward.
// ghost = 0: solid toy-plastic look. pulse adds an emissive glow (the pieces to place now).
// reveal / alphaMul scale the alpha (reveal animations, "already placed" fading).
input_color4 baseColor;
input_color4 rimColor;
input_float ghost;
input_float pulse;
input_float reveal;
input_float alphaMul;
output_vec3 transformedPosition;
output_vec4 vertexColor;

void main() {
    vec3 objPos = system.getSurfacePositionObjectSpace();
    vec3 objN = system.getSurfaceNormalObjectSpace();
    mat4 w = system.getMatrixWorld();
    vec3 worldPos = (w * vec4(objPos, 1.0)).xyz;
    // the generated graph wires transformedPosition straight into Surface.WorldPosition (world space)
    transformedPosition = worldPos;
    vec3 n = normalize((w * vec4(objN, 0.0)).xyz);
    vec3 camPos = system.getMatrixCamera()[3].xyz;
    vec3 v = normalize(camPos - worldPos);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);
    vec3 L = normalize(vec3(0.35, 1.0, 0.45));
    float light = 0.55 + 0.45 * max(0.0, dot(n, L));
    float t = mod(system.getTimeElapsed(), 64.0);
    // scanline band sweeping upward through the hologram (world cm)
    float band = fract(worldPos.y * 0.25 - t * 0.6);
    float scan = smoothstep(0.75, 0.95, band) * (1.0 - smoothstep(0.95, 1.0, band));
    vec3 solid = baseColor.rgb * light + vec3(fres * 0.12);
    // lifted a little so dark bricks (blue, brown) still read as a ghost on bright backgrounds and on the additive display
    vec3 holo = baseColor.rgb * (0.6 + 0.4 * light) + vec3(0.12) + rimColor.rgb * (fres * 0.35 + scan * 0.15);
    vec3 rgb = mix(solid, holo, ghost);
    rgb += baseColor.rgb * pulse * 0.6 + rimColor.rgb * pulse * fres * 0.25;
    rgb = min(rgb, vec3(1.0));
    float aHolo = 0.5 + 0.3 * fres + 0.15 * scan + 0.3 * pulse;
    float a = mix(1.0, aHolo, ghost) * reveal * alphaMul * baseColor.a;
    vertexColor = vec4(rgb, clamp(a, 0.0, 1.0));
}
