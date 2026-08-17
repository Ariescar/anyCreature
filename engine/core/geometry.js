// ACS engine — geometry core.
// Lineage: Ariescar's Creature project (animal_gen.js) — rotation-minimizing frames,
// miter ring normals, ground-anchored frames, bone-centered rings. Author: Ariescar.
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]),nrm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l];};
function rod(v,ax,ang){const c=Math.cos(ang),s=Math.sin(ang),cr=cross(ax,v),d=dot(ax,v);return[v[0]*c+cr[0]*s+ax[0]*d*(1-c),v[1]*c+cr[1]*s+ax[1]*d*(1-c),v[2]*c+cr[2]*s+ax[2]*d*(1-c)];}
// Parallel-transport frame (rotation-minimizing, no twist) · one ring per point · ring centre = that bone point.
// ★ Ring normal = bone-chain angle bisector (central-difference miter, iron law 18): ring tilt follows the bone bend; no arbitrary tilt.
// radii[s] may be a scalar r (circle) or [rw,rh] (ellipse; rw = horizontal width radius, rh = vertical height radius).
// upFrame=true: use the world-up frame (width→horizontal, height→vertical) → allows flat bodies (fish/salamander); adjacent rings stay aligned, no twist.
//   (near-horizontal axial bodies: up-frame is stable; vertical legs → use the default parallel-transport circular frame). Ring normal is still the bone-angle miter (iron law 18).
// ★ Single source of truth: per-point orthogonal frame {tan (tangent, angle-bisector miter), fr:[U (width), W (height)]}. Generation and [fit inverse/rebuild] share one function → invertible.
function framesOf(pts,upFrame){
  const n=pts.length,tan=[];
  for(let s=0;s<n;s++){let t;
    if(n===1)t=[0,0,1];
    else if(s===0)t=nrm(sub(pts[1],pts[0]));
    else if(s===n-1)t=nrm(sub(pts[n-1],pts[n-2]));
    else t=nrm(add(nrm(sub(pts[s+1],pts[s])),nrm(sub(pts[s],pts[s-1]))));  // angle-bisector miter
    tan.push(t);}
  let fr=[];
  if(upFrame&&upFrame!=='ground'){   // ★ 'ground' is a string and would make if(upFrame) misread it as up-frame — exclude it first
    // ★ The ring coordinate system must be a pure function of the tangent WITH a fixed sign, or it is not comparable across species (2026-08-03).
    //   Old code: "if the tangent is near vertical, swap the reference axis from +Y to +Z" — at the instant of the swap cross(up,t) flips sign entirely and U rotates 180°.
    //   Measured: duck neck end tangent ≈(0,1,0.01) yielded U=(-1,0,0); deer neck at the same station, tangent (0,0.59,0.81), yielded U=(+1,0,0),
    //   so the two parents' first harmonics were EXACTLY 180° out of phase → blending cancelled them, ring radii 4.89/3.95 collapsed to 0.42, and the neck snapped down to a thread.
    //   Fix: fix the sign after computing U — U always points toward world +X (creatures are bilaterally symmetric, so an axial part's width axis already lies along ±X);
    //   when U is near-perpendicular to X, fall back to +Y then +Z. On a flip, negate U and W together to keep the frame right-handed (equivalent to a 180° rotation about the tangent).
    //   Encoding and rebuilding both call the same framesOf, so this change is an identity for a SINGLE species' round-trip reproduction.
    for(let s=0;s<n;s++){const t=tan[s];const up=Math.abs(dot(t,[0,1,0]))>0.99?[0,0,1]:[0,1,0];
      let U=nrm(cross(up,t)),W=nrm(cross(t,U));
      for(const a of [[1,0,0],[0,1,0],[0,0,1]]){ const dd=dot(U,a);
        if(Math.abs(dd)>0.1){ if(dd<0){U=mul(U,-1);W=mul(W,-1);} break; } }
      fr.push([U,W]);} // U = horizontal width axis, W = vertical height axis
  } else if(upFrame==='ground'){
    // ★ Ground-anchored frame (2026-07-29): U = world DOWN projected onto the ring plane. When the ring plane is near horizontal, fall back to world -Z.
    //   Why it is needed: a parallel-transport frame's absolute roll is decided by its own bone chain, so it is not comparable across species — measured, the same
    //   "lowest point of the end ring" sits at -119° in the horse's frame, +90° in the giraffe's, +137° in the theropod's. Blending by index therefore averages
    //   vectors pointing in different world directions: two flat foot soles blend into a non-flat one (0.482~1.454).
    //   With down-anchoring, the bottom edge always lands at local angle ~0°; pure blending (zero post-processing) gives sole deviation 0.0002~0.055.
    //   Equivalent to the old studio line's "strip pitch/roll from ring orientation, keep only yaw → soles flat by construction".
    for(let s=0;s<n;s++){const t=tan[s];
      let d=[0,-1,0],U=sub(d,mul(t,dot(d,t)));
      if(len(U)<0.15){d=[0,0,-1];U=sub(d,mul(t,dot(d,t)));}
      U=nrm(U);fr.push([U,nrm(cross(t,U))]);}
  } else {
    const ref=Math.abs(tan[0][1])<0.9?[0,1,0]:[1,0,0];let U=nrm(cross(tan[0],ref));fr.push([U,nrm(cross(tan[0],U))]);
    for(let s=1;s<n;s++){const t0=tan[s-1],t1=tan[s];let Un=fr[s-1][0];const ax=cross(t0,t1);if(len(ax)>1e-6){const a=nrm(ax),ang=Math.acos(Math.max(-1,Math.min(1,dot(t0,t1))));Un=rod(Un,a,ang);}Un=nrm(sub(Un,mul(t1,dot(Un,t1))));fr.push([Un,nrm(cross(t1,Un))]);}
  }
  return {tan,fr};
}
function chainRings(pts,radii,N,upFrame){
  const n=pts.length, {fr}=framesOf(pts,upFrame);
  const rad=s=>Array.isArray(radii[s])?radii[s]:[radii[s],radii[s]];        // [rw,rh]
  const rings=[];for(let s=0;s<n;s++){const U2=fr[s][0],W2=fr[s][1],[rw,rh]=rad(s),r=[];for(let k=0;k<N;k++){const a=2*Math.PI*k/N;r.push(add(pts[s],add(mul(U2,Math.cos(a)*rw),mul(W2,Math.sin(a)*rh))));}rings.push(r);}
  return rings;
}
// rings→mesh. ★ centers = the bone point at each ring's centre (used by the bone-centre gate).
// ★ Cap STYLE is a topological property of the part, not a constant (2026-07-31).
//   Real failure: hybrids always emitted (...,true,true) = FAN caps at both ends (one extra centre vertex + N triangles),
//   but the canonical ear is actually an NGON cap (12 verts / 10 all-quad faces, no centre vertex) → hybrid ears went from 12v/10f to 14v/18f,
//   and the root, which should stay OPEN (buried in the head), got sealed = the "ear topology error" the user pointed out in the viewport.
//   capS/capE stay backward compatible: true→'fan' (bit-for-bit unchanged), false→'none'; 'ngon' (centre-less polygon cap) is new.
function partFromRings(rings,N,capS,capE,centers){
  const V=[],F=[],idx=[];
  for(const r of rings){const ri=[];for(const p of r){ri.push(V.length);V.push(p.slice());}idx.push(ri);}
  for(let s=0;s<idx.length-1;s++)for(let k=0;k<N;k++)F.push([idx[s][k],idx[s][(k+1)%N],idx[s+1][(k+1)%N],idx[s+1][k]]);
  const styleOf=x=>x===true?'fan':(x===false||x==null?'none':x);   // 'fanx' = slightly convex (synthesis path only)
  // ★ Convex caps (2026-07-31, CAP switch): once the sole is flattened the end ring is no longer planar, and a flat fan cap FOLDS BACK INTO the tube
  //   — measured, 563 of the leg's self-intersection points involve the end cap and only 38 the root cap. Push the cap centre slightly outward along the tube axis
  //   and the cap becomes a shallow cone, structurally incapable of caving back into the tube. The push scales with that ring's radius (no absolute constant).
  // ★ 'fanx' = convex fan cap: synthesis path (hybrids) ONLY. The fit path must reproduce the user's REF bit-for-bit — do not touch it.
  const CONVEX_K=+(process.env.CAPK||0.15);
  const capFan=(ri,fl,nb,cvx)=>{let c=[0,0,0];for(const i of ri)c=add(c,V[i]);c=mul(c,1/N);
    // ★ Push the cap centre outward along THE RING'S OWN NORMAL by that ring's non-planarity (2026-08-01).
    //   Measured: self-intersecting legs have end-ring non-planarity median 0.178 / max 0.780; non-intersecting ones only 0.020 / max 0.506
    //   — sole flattening straightens the lower half of the ring while the upper half stays round, so the end ring is non-planar and the fan cap's triangles bend out into the side wall.
    //   Push amount = that ring's max distance from its best-fit plane (measured from data, not a constant); a planar ring pushes 0 = bit-for-bit unchanged.
    if(process.env.CAPLIFT==='on'){   /* Off by default: measured zero effect on pass rate (786/786); non-planarity and self-intersection are correlated, not causal */
      let nn=[0,0,0];
      for(let i=0;i<ri.length;i++){const p=V[ri[i]],q=V[ri[(i+1)%ri.length]];
        nn=[nn[0]+(p[1]-q[1])*(p[2]+q[2]), nn[1]+(p[2]-q[2])*(p[0]+q[0]), nn[2]+(p[0]-q[0])*(p[1]+q[1])];}
      const ln=len(nn);
      if(ln>1e-9){ const u=[nn[0]/ln,nn[1]/ln,nn[2]/ln];
        let dev=0; for(const i of ri){const d=Math.abs(dot(sub(V[i],c),u)); if(d>dev)dev=d;}
        if(dev>1e-9){ const sgn=fl?-1:1; c=[c[0]+u[0]*dev*sgn, c[1]+u[1]*dev*sgn, c[2]+u[2]*dev*sgn]; } }
    }
    if(cvx&&nb&&nb.length){ let nc=[0,0,0];for(const i of nb)nc=add(nc,V[i]);nc=mul(nc,1/nb.length);
      const ax=sub(c,nc), L=len(ax);
      if(L>1e-9){ const rr=ri.reduce((t,i)=>t+len(sub(V[i],c)),0)/ri.length;
        c=add(c,mul(ax,CONVEX_K*rr/L)); } }
    const ci=V.length;V.push(c);for(let k=0;k<N;k++)F.push(fl?[ri[(k+1)%N],ri[k],ci]:[ri[k],ri[(k+1)%N],ci]);};
  // Ngon cap: no centre vertex; the ring's own points form the faces (even edge count → quad strip; odd → one triangle at the end)
  const capNgon=(ri,fl)=>{const o=fl?ri.slice().reverse():ri.slice(), m=o.length;
    // Fan quads out from o[0]; an even edge count covers exactly (hexagon = 2 quads), an odd count needs one closing triangle.
    // ★ The old code's closing-triangle condition was wrong: hexagons got two extra triangles (ear 12 faces vs canonical 10).
    let last=0;
    for(let k=0;k+3<m;k+=2){F.push([o[0],o[k+1],o[k+2],o[k+3]]); last=k+3;}
    if(last<m-1)F.push([o[0],o[m-2],o[m-1]]);};
  const doCap=(ri,fl,st,nb)=>{ if(st==='fan'||st==='fanx')capFan(ri,fl,nb,st==='fanx'); else if(st==='ngon')capNgon(ri,fl); };
  doCap(idx[idx.length-1],false,styleOf(capE),idx.length>1?idx[idx.length-2]:null);
  doCap(idx[0],true,styleOf(capS),idx.length>1?idx[1]:null);
  // ★★★ Single source of truth (same fix as buildPartFromFit): v was rounded while rings kept raw values → the two sides round differently at the .0005 boundary.
  //   Rings must always POINT AT the vertex object inside v; never keep a separate copy.
  const Vr=V.map(q=>q.map(x=>+x.toFixed(3)));
  let _o=0; const Rr=rings.map(r=>r.map(()=>Vr[_o++]));
  return {v:Vr,fq:F,rings:Rr,centers:(centers||[]).slice()};
}
module.exports = { sub, add, mul, cross, dot, len, nrm, rod, framesOf, chainRings, partFromRings };
