// ΔE2000 计算 + 候选均线调色板搜索（一次性工具）
const hex2rgb = h => { const n = parseInt(h.replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
const srgb2lin = c => { c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
function lab(hex){ const [r,g,b]=hex2rgb(hex); const R=srgb2lin(r),G=srgb2lin(g),B=srgb2lin(b);
  let x=(R*0.4124564+G*0.3575761+B*0.1804375)/0.95047;
  let y=(R*0.2126729+G*0.7151522+B*0.0721750)/1.0;
  let z=(R*0.0193339+G*0.1191920+B*0.9503041)/1.08883;
  const f=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  x=f(x);y=f(y);z=f(z);
  return [116*y-16, 500*(x-y), 200*(y-z)];
}
function de2000(h1,h2){
  const [L1,a1,b1]=lab(h1),[L2,a2,b2]=lab(h2);
  const kL=1,kC=1,kH=1;
  const C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cb=(C1+C2)/2;
  const G=0.5*(1-Math.sqrt(Math.pow(Cb,7)/(Math.pow(Cb,7)+Math.pow(25,7))));
  const ap1=(1+G)*a1,ap2=(1+G)*a2;
  const Cp1=Math.hypot(ap1,b1),Cp2=Math.hypot(ap2,b2);
  const hp1=(ap1===0&&b1===0)?0:(Math.atan2(b1,ap1)*180/Math.PI+360)%360;
  const hp2=(ap2===0&&b2===0)?0:(Math.atan2(b2,ap2)*180/Math.PI+360)%360;
  const dLp=L2-L1,dCp=Cp2-Cp1;
  let dhp;
  if(Cp1*Cp2===0) dhp=0;
  else if(Math.abs(hp2-hp1)<=180) dhp=hp2-hp1;
  else if(hp2-hp1>180) dhp=hp2-hp1-360;
  else dhp=hp2-hp1+360;
  const dHp=2*Math.sqrt(Cp1*Cp2)*Math.sin(dhp*Math.PI/360);
  const Lbp=(L1+L2)/2,Cbp=(Cp1+Cp2)/2;
  let hbp;
  if(Cp1*Cp2===0) hbp=hp1+hp2;
  else if(Math.abs(hp1-hp2)<=180) hbp=(hp1+hp2)/2;
  else if(hp1+hp2<360) hbp=(hp1+hp2+360)/2;
  else hbp=(hp1+hp2-360)/2;
  const T=1-0.17*Math.cos((hbp-30)*Math.PI/180)+0.24*Math.cos(2*hbp*Math.PI/180)+0.32*Math.cos((3*hbp+6)*Math.PI/180)-0.20*Math.cos((4*hbp-63)*Math.PI/180);
  const dth=30*Math.exp(-Math.pow((hbp-275)/25,2));
  const Rc=2*Math.sqrt(Math.pow(Cbp,7)/(Math.pow(Cbp,7)+Math.pow(25,7)));
  const Sl=1+(0.015*Math.pow(Lbp-50,2))/Math.sqrt(20+Math.pow(Lbp-50,2));
  const Sc=1+0.045*Cbp; const Sh=1+0.015*Cbp*T;
  const Rt=-Math.sin(2*dth*Math.PI/180)*Rc;
  return Math.sqrt(Math.pow(dLp/(kL*Sl),2)+Math.pow(dCp/(kC*Sc),2)+Math.pow(dHp/(kH*Sh),2)+Rt*(dCp/(kC*Sc))*(dHp/(kH*Sh)));
}
const lum=hex=>{const [r,g,b]=hex2rgb(hex);return 0.2126*srgb2lin(r)+0.7152*srgb2lin(g)+0.0722*srgb2lin(b);};
const contrast=(a,b)=>{const L1=lum(a),L2=lum(b);const hi=Math.max(L1,L2),lo=Math.min(L1,L2);return (hi+0.05)/(lo+0.05);};

const ACCENT='#35e1ff', UP='#ff4d5e', DOWN='#16c784', BG='#0a0f16';
const cands = {
  '#5b8def':'blue', '#7c6cf0':'indigo', '#b06ad4':'purple', '#e0559b':'pink',
  '#aab82e':'olive', '#f0a03c':'amber', '#2fbf9a':'teal', '#e07a5f':'coral',
  '#4fc3f7':'sky', '#9ccc65':'lime', '#ba9bff':'lav', '#ff8fab':'rose',
};
const base=[ACCENT,UP,DOWN];
console.log('--- 候选对现有三色的最小色距 ---');
const rows=Object.entries(cands).map(([h,name])=>{
  const ds=[...base,UP,DOWN].map(b=>de2000(h,b));
  return {h,name,min:Math.min(...ds.filter((_,i)=>i<3)), vsUp:de2000(h,UP), vsDown:de2000(h,DOWN), c:contrast(h,BG)};
});
rows.sort((a,b)=>b.min-a.min).forEach(r=>console.log(r.name.padEnd(8), r.h, 'minΔE', r.min.toFixed(1), 'vsUp', r.vsUp.toFixed(1), 'vsDown', r.vsDown.toFixed(1), 'contrast', r.c.toFixed(2), (r.c>=4&&r.c<=9?'':'⚠')));
console.log('\n accent vs bg contrast', contrast(ACCENT,BG).toFixed(2), 'up', contrast(UP,BG).toFixed(2), 'down', contrast(DOWN,BG).toFixed(2));
