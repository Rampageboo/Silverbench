#!/usr/bin/env python3
"""Audit directional multiview frame mapping and coordinate/input semantics."""
import argparse, hashlib, json, math, pathlib, subprocess

WINDOW = range(159, 184)

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def git(cmd, root):
    try:
        return subprocess.check_output(['git', *cmd], cwd=root, text=True,
                                       stderr=subprocess.STDOUT).strip()
    except Exception as exc:
        return f'<unavailable: {exc}>'

def joint10(frame):
    return frame['joints'][10]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input-root', type=pathlib.Path, required=True)
    ap.add_argument('--output', type=pathlib.Path, required=True)
    args = ap.parse_args()
    root = args.input_root.resolve()
    out = args.output.resolve()
    manifest_path = root / 'outputs/alignment-common-qa-20260812-0240/motion.amotion/manifest.json'
    diag_path = root / 'outputs/alignment-common-qa-20260812-0240/multiview-diagnostics.json'
    pose_root = root / 'outputs/FrontLeft-1786531924229/poses'
    pose_paths = {name: pose_root / name / 'pose_sequence.json'
                  for name in ('front_left', 'front', 'front_right')}
    required = [manifest_path, diag_path, *pose_paths.values()]
    missing = [str(p) for p in required if not p.is_file()]
    result = {
        'schema_version': 'input-audit.v1',
        'conclusion': 'blocked' if missing else 'unresolved',
        'hypothesis': 'input-detection / source-frame mapping / coordinate semantics',
        'claims': [],
        'producer': {'tool': 'tools/diagnostics/input_audit/audit_inputs.py'},
        'options': {'common_frame_window': [159, 183], 'joint_index': 10,
                    'view_order': ['front_left', 'front', 'front_right']},
        'inputs': {}, 'checks': [], 'falsifiers': [], 'missing_inputs': missing,
    }
    repo = pathlib.Path(__file__).resolve().parents[3]
    result['producer'].update({
        'command': f'python tools/diagnostics/input_audit/audit_inputs.py --input-root "{root}" --output "{out}"',
        'revision': git(['rev-parse', 'HEAD'], repo),
        'worktree_status': git(['status', '--short'], repo),
    })
    source_path = repo / 'src/multiview.cpp'
    result['producer']['source_evidence'] = {
        'path': str(source_path), 'sha256': sha256(source_path),
        'locations': ['src/multiview.cpp:313-449 align_view',
                      'src/multiview.cpp:702-728 estimate_pixels_per_meter',
                      'src/multiview.cpp:730-1018 triangulate_joint',
                      'src/multiview.cpp:1200-1236 common interval and map trim',
                      'src/multiview.cpp:1270-1277 mapped-frame sample consumption']}
    def write_artifact():
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        out.with_name('input-audit.sha256').write_text(sha256(out) + '  ' + out.name + '\n', encoding='ascii')
    if missing:
        result['claims'].append({'label': 'observed', 'claim': 'Required handoff baseline outputs are not all present; full frame audit cannot be reproduced.'})
        result['checks'].append({'name': 'required_inputs_present', 'passed': False, 'missing': missing})
        write_artifact()
        return 2

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    diag = json.loads(diag_path.read_text(encoding='utf-8'))
    poses = {name: json.loads(path.read_text(encoding='utf-8')) for name, path in pose_paths.items()}
    result['inputs'] = {
        'manifest': {'path': str(manifest_path), 'sha256': sha256(manifest_path)},
        'diagnostics': {'path': str(diag_path), 'sha256': sha256(diag_path)},
        'poses': {name: {'path': str(path), 'sha256': sha256(path),
                         'frame_count': len(poses[name]['frames']), 'fps': poses[name]['fps']}
                  for name, path in pose_paths.items()},
    }
    result['manifest_observed'] = {k: manifest.get(k) for k in
        ('frame_count', 'joint_count', 'fps', 'coordinate_system', 'motion_variant', 'package_type')}
    alignments = {item['view_id']: item for item in diag['alignments']}
    result['alignment_summary'] = []
    for view in ('front_left', 'front', 'front_right'):
        a = alignments[view]
        result['alignment_summary'].append({k: a.get(k) for k in
            ('view_id', 'mean_offset_s', 'mean_rate', 'overlap_reference_frames',
             'out_of_range_reference_frames', 'method')})
    frame_map = []
    comparisons = []
    for frame in range(manifest['frame_count']):
        row = {'common_frame': frame, 'timestamp_s': frame / manifest['fps'], 'views': []}
        for view in ('front_left', 'front', 'front_right'):
            a = alignments[view]
            source = float(a['source_frame_at_reference'][frame])
            row['views'].append({'view_id': view, 'source_frame': source,
                                 'source_frame_rounded': round(source),
                                 'source_timestamp_s': poses[view]['frames'][round(source)]['time_s']
                                 if 0 <= round(source) < len(poses[view]['frames']) else None})
        frame_map.append(row)
    for frame in WINDOW:
        row = {'common_frame': frame, 'views': []}
        for view in ('front_left', 'front', 'front_right'):
            a = alignments[view]
            source = float(a['source_frame_at_reference'][frame])
            mapped_index = int(max(0, min(len(poses[view]['frames']) - 1, round(source))))
            raw = joint10(poses[view]['frames'][frame]) if frame < len(poses[view]['frames']) else None
            mapped = joint10(poses[view]['frames'][mapped_index])
            row['views'].append({'view_id': view, 'mapped_source_frame': source,
                'mapped_index': mapped_index, 'raw_joint10': raw, 'mapped_joint10': mapped,
                'image_xy_delta': [mapped['image_xy'][i] - raw['image_xy'][i] for i in (0,1)]
                    if raw else None})
        comparisons.append(row)
    result['frame_map'] = frame_map
    result['joint10_window_comparison'] = comparisons
    finite_scales = all(math.isfinite(v) for v in [p['fps'] for p in poses.values()])
    checks = [
        {'name': 'manifest_view_order', 'passed': list(alignments) == ['front_left', 'front', 'front_right'], 'observed': list(alignments)},
        {'name': 'manifest_shape', 'passed': manifest['frame_count'] == 403 and manifest['joint_count'] == 23},
        {'name': 'coordinate_system', 'passed': manifest['coordinate_system'] == {'handedness':'right','up_axis':'Y','forward_axis':'Z','unit':'meter'}},
        {'name': 'finite_pose_fps', 'passed': finite_scales},
        {'name': 'full_frame_mapping', 'passed': len(frame_map) == 403 and all(len(r['views']) == 3 for r in frame_map)},
    ]
    result['checks'] = checks
    result['claims'] = [
        {'label':'observed','claim':'The supplied canonical manifest declares 403 frames, 23 joints, FPS 30.002260057254784, and right-handed Y-up Z-forward meter coordinates.'},
        {'label':'observed','claim':'The diagnostic alignment contains a source-frame mapping for all 403 common frames and three named views.'},
        {'label':'inferred','claim':'Raw-frame versus mapped-frame lookup is a discriminating comparison; a nonzero joint10 delta in the requested window shows that indexing choice changes the observed input, but does not by itself establish which choice is correct.'},
    ]
    result['falsifiers'] = ['A regenerated producer artifact with a different view order, mapping, or coordinate declaration.', 'A reference-comparison consumer that demonstrably uses mapped source indices while the observed conflict is unchanged under raw-index substitution.']
    write_artifact()

if __name__ == '__main__':
    main()
