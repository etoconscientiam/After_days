"""Fit the lowercase/extra letters (letters.py) to the reference."""
import sys, os, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
FIT = os.path.join(os.path.dirname(HERE), 'src', 'fitted.json')
REF = sys.argv[1]
B = 'Jt,Jb,M,Tx,Bx,Jd,J1,T1,T2,L1,L2,B2,B1,Jd2,J2,Side,Th,Bh,Ct,Cb,CM,CTx,CBx,Cd,C1,CT1,CT2,CL1,CL2,CB2,CB1,Cd2,C2'.split(',')
GROUPS = [
    ('r', 'rJo,rC,rXt,rHa,rEo,rEw,rJoK,rLk,rRk,rRv,rIv,rIk'),
    ('s', 'sThick,sThin,sK,sTx,sTy,sTopX,sULx,sULy,sLRx,sLRy,sBotX,sEx,sEy,sk1,sk2,sk3,sCa'),
    ('d', ','.join('b' + x for x in B)),
    ('p', ','.join('p' + x for x in B) + ',pJt'),
    ('g', 'gUx0,gUx1,gUy0,gUs,gUt,gUto,gUti,gEh,gEi,gLx0,gLx1,gLy1,gLs,gLto,gLb,gLt,gLti,gKsx,gKsy,gKtx,gKty,gKw'),
    ('c', 'cTt,cTa,cBt,cBa,cSide,cTop,cBot,cTo,cTi'),
    ('e', 'eBar,eBy,eBt,eBa,eSide,eTop,eBot,eTo,eTi'),
    ('t', 'tStem,tTail,tCut,tBar,tBarR,tBx,tEy,tHk,tO1,tO2,tO3,tEw,tI3,tI2,tI1'),
    ('f', 'fStem,fJoin,fOv,fTx,fEy,fHk,fBar,fBarR,fO1,fO2,fO3,fEw,fI3,fI2,fI1'),
    ('m', 'mMid'),
    ('v', 'vWt,vWb,vYi'),
    ('W', 'Wb,WWt,WWb,WWm,WWi,WVx'),
    ('i', 'iDot,iTens'),
]
only = os.environ.get('GL', '')
for mkey, ropsz in (('G33', 33), ('G12', 14)):
    for rnd in range(int(os.environ.get('ROUNDS', 1))):
        for g, names in GROUPS:
            if only and g not in only:
                continue
            fitted = json.load(open(FIT)) if os.path.exists(FIT) else {}
            out = subprocess.run([sys.executable, os.path.join(HERE, 'fit.py'), mkey, g, str(ropsz), names, REF],
                                 capture_output=True, text=True)
            lines = out.stdout.strip().splitlines()
            if not lines or not lines[-1].startswith('{'):
                print(mkey, g, 'FAILED', (out.stdout + out.stderr)[-300:]); continue
            fitted.setdefault(mkey, {}).update(json.loads(lines[-1]))
            json.dump(fitted, open(FIT, 'w'), indent=1)
            print(mkey, rnd, g, lines[0], lines[1], flush=True)
