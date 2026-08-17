#!/usr/bin/env python3
"""Calibration (L1): prove the ruler tells good from bad, per ruler.
green    = the bred example wolf (must build clean)
red      = legacy multi-fault wolf (must be blocked)
red_5050 = violates ONLY the 50:50 proportion rule — must be blocked AND the
           block reason must actually be 'proportion' (a red sample that fails
           for other reasons proves nothing about this ruler)."""
import subprocess, os, sys, tempfile
H = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(H, '..')
tmp = tempfile.mkdtemp(prefix='calib_')

def build(spec):
    p = subprocess.run(['node', os.path.join(R, 'engine', 'cli.js'),
                        os.path.join(R, 'calibration', spec),
                        os.path.join(tmp, spec + '.glb')],
                       capture_output=True, text=True)
    return p.returncode, p.stderr

rc_g, _ = build('wolf_green.json')
rc_r, _ = build('wolf_red.json')
rc_5, err5 = build('red_5050.json')
ok_g = rc_g == 0
ok_r = rc_r != 0
ok_5 = rc_5 != 0 and 'proportion' in err5

print(f"green (known-good)        -> {'PASS ✓' if ok_g else 'blocked ✗ (ruler too strict)'}")
print(f"red   (multi-fault)       -> {'blocked ✓' if ok_r else 'PASSED ✗ (ruler too loose)'}")
print(f"red_5050 (only 50:50)     -> {'blocked by proportion ✓' if ok_5 else 'NOT blocked by proportion ✗'}")
if ok_g and ok_r and ok_5:
    print('[calibrate] OK: the rulers separate good from bad.')
else:
    print('[calibrate] FAILED — do not start work; report this.')
    sys.exit(1)
