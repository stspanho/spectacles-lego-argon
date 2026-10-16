#!/usr/bin/env python3
"""Build Assets/Shaders/*.glsl into LS 5.15 .ss_graph + .mat (+ .meta pinning the UUIDs).

Uses ~/lens-studio/Resources/ss_graph_tool (same recipe as spectacles-lego tools/devkit/graphshaders_to_ssgraph.py).
The generated graph wires the Code Node's `transformedPosition` straight into Surface.WorldPosition, so every
shader here must output WORLD-space positions.

  python3 tools/build_shaders.py            # all shaders
  python3 tools/build_shaders.py BrickDust  # one

Body-only edits while LS is open: `ss_graph_tool.py update <ss_graph> <glsl>` is safe; a full rebuild of an
already-imported graph is not (LS rewrites it from memory) — quit LS first.
"""
import importlib.util, pathlib, re, sys, uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
SH = ROOT / "Assets" / "Shaders"
SS = pathlib.Path.home() / "lens-studio/Resources/ss_graph_tool/ss_graph_tool.py"
spec = importlib.util.spec_from_file_location("sst", SS)
sst = importlib.util.module_from_spec(spec); spec.loader.exec_module(sst)

# Pass flags baked into the .mat (the TS drivers set them on clones too; these are the asset defaults).
FLAGS = {
    "BrickHolo": {"BlendMode": "Normal", "DepthWrite": "false", "DepthTest": "true", "TwoSided": "false"},
    "BrickDust": {"BlendMode": "Disabled", "DepthWrite": "true", "DepthTest": "true", "TwoSided": "false", "InstanceCount": "240"},
}

META = """- !<AssetImportMetadata/{meta_id}>
  ImportedAssetIds:
    {kind}: !<reference> {asset_id}
  ImporterName: {importer}
  PrimaryAsset: !<reference> {asset_id}
  PackageType: NotAPackage
  LegacyPackagePolicy: ~
  ExtraData:
    {{}}
  AssetDataMap:
    {{}}
  DependentFiles:
    []
  ImporterSettings: !<AssetImporterSettings>
    {{}}
  CompressionSettings: !<own> 00000000-0000-0000-0000-000000000000
"""


def existing_id(meta_path, kind):
    if meta_path.exists():
        m = re.search(rf"{kind}: !<reference> ([0-9a-f-]{{36}})", meta_path.read_text())
        if m:
            return m.group(1)
    return str(uuid.uuid4())


def write_meta(meta_path, asset_id, kind, importer):
    meta_path.write_text(META.format(meta_id=uuid.uuid4(), kind=kind, asset_id=asset_id, importer=importer))


# .mat `Properties` typeIdx + value literal per GLSL input type (the bundled tool writes every one as a float).
PROP_TYPES = {
    "float": (1, "1.000000"), "int": (1, "1"), "bool": (0, "1"),
    "vec2": (3, "{x: 1.000000, y: 1.000000}"), "vec3": (4, "{x: 1.000000, y: 1.000000, z: 1.000000}"),
    "color3": (4, "{x: 1.000000, y: 1.000000, z: 1.000000}"),
    "vec4": (5, "{x: 1.000000, y: 1.000000, z: 1.000000, w: 1.000000}"),
    "color4": (5, "{x: 1.000000, y: 1.000000, z: 1.000000, w: 1.000000}"),
}
MAT_ONLY = "--mat-only" in sys.argv


def build(name):
    code = (SH / f"{name}.glsl").read_text()
    if any(ord(c) > 127 for c in code):
        raise SystemExit(f"{name}.glsl contains non-ASCII characters (LS Code Node compiler chokes on them)")
    inputs, outputs = sst.parse_js_declarations(code)
    print(f"== {name}: inputs={[n for n, _ in inputs]} outputs={[n for n, _ in outputs]}")
    graph = SH / f"{name}.ss_graph"
    gid = existing_id(pathlib.Path(str(graph) + ".meta"), "ShaderGraph")
    if not MAT_ONLY:
        sst.generate_ss_graph(code, inputs, str(graph), outputs=outputs or None)
        write_meta(pathlib.Path(str(graph) + ".meta"), gid, "ShaderGraph", "ShaderGraphPassImporter")
    mat = SH / f"{name}.mat"
    mid = existing_id(pathlib.Path(str(mat) + ".meta"), "Material")
    sst.generate_mat_file(str(mat), gid, mid, pass_info_id=str(uuid.uuid4()), pass_ref_id=gid, inputs=inputs,
                          tweak_lids=list(range(2, 2 + len(inputs))), code_lid=0, surface_lid=1)
    s = mat.read_text()
    for pname, ptype in inputs:
        tidx, lit = PROP_TYPES.get(ptype, (1, "1.000000"))
        s, n = re.subn(rf"(\n    {pname}:\n      typeIdx: )\d+(\n      value: ).*", lambda m: m.group(1) + str(tidx) + m.group(2) + lit, s, count=1)
        if not n:
            print(f"   WARNING: property {pname} not found in {mat.name}")
    for k, v in FLAGS.get(name, {}).items():
        s, n = re.subn(rf"\n  {k}: .*", f"\n  {k}: {v}", s, count=1)
        if not n:
            print(f"   WARNING: flag {k} not found in {mat.name}")
    mat.write_text(s)
    write_meta(pathlib.Path(str(mat) + ".meta"), mid, "Material", "MaterialImporter")
    print(f"   wrote {graph.name} ({gid}) + {mat.name} ({mid})")


names = [a for a in sys.argv[1:] if not a.startswith("--")] or sorted(p.stem for p in SH.glob("*.glsl"))
for n in names:
    build(n)
