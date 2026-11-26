"""Fit every Latin glyph of the grotesk masters to the reference and store
the result in src/fitted.json (merged over masters.M by masters.params)."""
import sys, os, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
FIT = os.path.join(os.path.dirname(HERE), 'src', 'fitted.json')
REF = sys.argv[1]
GROUPS = {
    'a': 'aBt,aBm,aBx,aBb,aTbx,aTbdy,aT1,aT1y,aT2,aL1,aL2,aTcx,aTcdy,aTc1,aTc1y,aTc2,aCL1,aCL2,aCb,aB2a,aB2b,aB3a,aB3b,aB3d,aHtop,aVb,aHlb,aCmy,aCbx,aC2a,aC2b,aC3a,aC3b,aC3d,aTaper',
    'a2': 'aHs,aHi,aHk,aTix,aDs,aEx,aEy,aTopX,aO1,aO2,aShK,aShV,aI1,aI2,aI3,aI4',
    'n': 'yJo,yC,ySh,xT,xTi,nTaper,nLeftK,nJoK,nShK,nShV',
    'o': 'tensOo,tensIo,topK,oSideK',
    'O': 'tensO,tensI,sideKO,topKO,wO',
    'H': 'hY,Hc,wH',
}
for mkey, ropsz in (('G33', 33), ('G12', 14)):
    if os.environ.get('ONLY') and mkey not in os.environ['ONLY']: continue
    for rnd in range(int(os.environ.get('ROUNDS', 2))):
        for grp, names in GROUPS.items():
            if os.environ.get('GRP') and grp not in os.environ['GRP'].split(','): continue
            g = grp[0]
            fitted = json.load(open(FIT)) if os.path.exists(FIT) else {}
            out = subprocess.run([sys.executable, os.path.join(HERE, 'fit.py'), mkey, g, str(ropsz), names, REF],
                                 capture_output=True, text=True)
            lines = out.stdout.strip().splitlines()
            if not lines or not lines[-1].startswith('{'):
                print(mkey, grp, 'FAILED', out.stderr[-400:]); continue
            res = json.loads(lines[-1])
            fitted.setdefault(mkey, {}).update(res)
            json.dump(fitted, open(FIT, 'w'), indent=1)
            print(mkey, rnd, grp, lines[0], lines[1])
