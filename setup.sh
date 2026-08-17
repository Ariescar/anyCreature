#!/bin/bash
# anyCreature one-command start: install deps → red/green ruler calibration
set -e
cd "$(dirname "$0")"
npm install three@0.180.0 playwright --no-fund --no-audit
# scipy is NOT optional: harness/maskmetrics.py imports scipy.ndimage. Leaving it
# out let setup print "calibrate OK" and then blow up mid-LOW on the first measure.
pip install numpy pillow scipy --break-system-packages -q 2>/dev/null || pip install numpy pillow scipy -q
python3 -c "import numpy, PIL, scipy.ndimage" || { echo "python deps missing"; exit 1; }
python3 harness/calibrate.py
echo "calibrate OK"
