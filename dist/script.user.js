// ==UserScript==
// @name         ColorCoder
// @namespace    color-coder
// @version      0.1.0
// @description  Encodes and decodes hidden pixel messages on wplace.live.
// @author       Larik01
// @match        https://wplace.live/*
// @run-at       document-start
// @noframes
// @grant        none
// @license      GPL-3.0
// ==/UserScript==
(()=>{var f=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var R=f((it,z)=>{var we=`abcdefghijklmnopqrstuvwxyz0123456789 .!?-_:;'"()[]{}@#$%&/=+<>`;z.exports={ALPHABET:we}});var G=f((st,U)=>{function ke(e){let t=5381;for(let o=0;o<e.length;o++)t=(t<<5)+t+e.charCodeAt(o),t=t|0;return t&31}U.exports={djb2Checksum5:ke}});var K=f((dt,W)=>{var{ALPHABET:q}=R(),{djb2Checksum5:Se}=G(),C=1,v=0,O=1023;function Le(e){let t=[];for(let o of e){let n=q.indexOf(o);if(n===-1)return console.warn('Character not in alphabet: "'+o+'"'),null;t.push(n)}return t}function Ce(e){let t="",o=!1;for(let n of e){if(n<0||n>=q.length){o=!0,t+="?";continue}t+=q[n]}return{text:t,badChars:o}}function Ee(e){let t=new TextEncoder().encode(e),o=[],n=0,a=0;for(let c of t)for(n=n<<8|c,a+=8;a>=6;)a-=6,o.push(n>>a&63);return a>0&&o.push(n<<6-a&63),o}function Te(e){let t=[],o=0,n=0;for(let s of e)for(o=o<<6|s,n+=6;n>=8;)n-=8,t.push(o>>n&255);let a=n>0&&(o&(1<<n)-1)!==0;return{text:new TextDecoder().decode(new Uint8Array(t)),badPadding:a}}function _(e,t,o,n){let a=e<<16|t<<15|o<<5|n;return[a>>12&63,a>>6&63,a&63]}function V(e,t,o){let n=e<<12|t<<6|o;return{version:n>>16&3,mode:n>>15&1,length:n>>5&1023,checksum:n&31}}function M(e,t,o,n){let a=e.toString(2).padStart(2,"0")+t.toString(2).padStart(1,"0")+o.toString(2).padStart(10,"0"),c=n.map(s=>s.toString(2).padStart(6,"0")).join("");return Se(a+c)}function De(e,t){let o=t===0?Le(e):Ee(e);if(!o)return null;if(o.length>O)return console.warn("Payload too long: "+o.length+" > "+O+" pixels"),null;let n=M(v,t,o.length,o),a=_(v,t,o.length,n);return{version:v,mode:t,length:o.length,checksum:n,header:a,payload:o,fullSequence:[C].concat(a,o),text:e}}function Pe(e){if(!e||e.length<4)return console.warn("Sequence too short for V1 (need >= 4 pixels)"),null;let t=e[0]===C;t||console.warn("Invalid start marker: expected "+C+", got "+e[0]);let{version:o,mode:n,length:a,checksum:c}=V(e[1],e[2],e[3]);if(o!==v)return console.warn("Unknown header version "+o+". This codec only understands V"+v+"."),{version:o,startMarkerValid:t,valid:!1,unknownVersion:!0,text:null};let s=e.length-4,i=s<a;i&&console.warn("Truncated message: header says "+a+" px but only "+s+" available.");let d=e.slice(4,4+a),p=M(o,n,d.length,d),P=p===c&&t&&!i,B,I=!1,A=!1;if(n===0){let w=Ce(d);B=w.text,I=w.badChars}else{let w=Te(d);B=w.text,A=w.badPadding}return I&&console.warn('Payload contains values outside Lite alphabet; replaced with "?".'),A&&console.warn("Non-zero padding bits at end of Full payload (possible corruption)."),{text:B,version:o,mode:n,length:a,storedChecksum:c,computedChecksum:p,valid:P,startMarkerValid:t,truncated:i,badChars:I,badPadding:A}}W.exports={encodeV1:De,decodeV1:Pe,packHeader:_,unpackHeader:V,checksumFor:M,START_MARKER:C,VERSION:v,MAX_PAYLOAD:O}});var N=f((lt,X)=>{var k=[{id:0,name:"Transparent",rgb:[0,0,0]},{id:1,name:"Black",rgb:[0,0,0]},{id:2,name:"Dark Gray",rgb:[60,60,60]},{id:3,name:"Gray",rgb:[120,120,120]},{id:4,name:"Light Gray",rgb:[210,210,210]},{id:5,name:"White",rgb:[255,255,255]},{id:6,name:"Deep Red",rgb:[96,0,24]},{id:7,name:"Red",rgb:[237,28,36]},{id:8,name:"Orange",rgb:[255,127,39]},{id:9,name:"Gold",rgb:[246,170,9]},{id:10,name:"Yellow",rgb:[249,221,59]},{id:11,name:"Light Yellow",rgb:[255,250,188]},{id:12,name:"Dark Green",rgb:[14,185,104]},{id:13,name:"Green",rgb:[19,230,123]},{id:14,name:"Light Green",rgb:[135,255,94]},{id:15,name:"Dark Teal",rgb:[12,129,110]},{id:16,name:"Teal",rgb:[16,174,166]},{id:17,name:"Light Teal",rgb:[19,225,190]},{id:18,name:"Dark Blue",rgb:[40,80,158]},{id:19,name:"Blue",rgb:[64,147,228]},{id:20,name:"Cyan",rgb:[96,247,242]},{id:21,name:"Indigo",rgb:[107,80,246]},{id:22,name:"Light Indigo",rgb:[153,177,251]},{id:23,name:"Dark Purple",rgb:[120,12,153]},{id:24,name:"Purple",rgb:[170,56,185]},{id:25,name:"Light Purple",rgb:[224,159,249]},{id:26,name:"Dark Pink",rgb:[203,0,122]},{id:27,name:"Pink",rgb:[236,31,128]},{id:28,name:"Light Pink",rgb:[243,141,169]},{id:29,name:"Dark Brown",rgb:[104,70,52]},{id:30,name:"Brown",rgb:[149,104,42]},{id:31,name:"Beige",rgb:[248,178,119]},{id:32,name:"Medium Gray",rgb:[170,170,170]},{id:33,name:"Dark Red",rgb:[165,14,30]},{id:34,name:"Light Red",rgb:[250,128,114]},{id:35,name:"Dark Orange",rgb:[228,92,26]},{id:36,name:"Light Tan",rgb:[214,181,148]},{id:37,name:"Dark Goldenrod",rgb:[156,132,49]},{id:38,name:"Goldenrod",rgb:[197,173,49]},{id:39,name:"Light Goldenrod",rgb:[232,212,95]},{id:40,name:"Dark Olive",rgb:[74,107,58]},{id:41,name:"Olive",rgb:[90,148,74]},{id:42,name:"Light Olive",rgb:[132,197,115]},{id:43,name:"Dark Cyan",rgb:[15,121,159]},{id:44,name:"Light Cyan",rgb:[187,250,242]},{id:45,name:"Light Blue",rgb:[125,199,255]},{id:46,name:"Dark Indigo",rgb:[77,49,184]},{id:47,name:"Dark Slate Blue",rgb:[74,66,132]},{id:48,name:"Slate Blue",rgb:[122,113,196]},{id:49,name:"Light Slate Blue",rgb:[181,174,241]},{id:50,name:"Light Brown",rgb:[219,164,99]},{id:51,name:"Dark Beige",rgb:[209,128,81]},{id:52,name:"Light Beige",rgb:[255,197,165]},{id:53,name:"Dark Peach",rgb:[155,82,73]},{id:54,name:"Peach",rgb:[209,128,120]},{id:55,name:"Light Peach",rgb:[250,182,164]},{id:56,name:"Dark Tan",rgb:[123,99,82]},{id:57,name:"Tan",rgb:[156,132,107]},{id:58,name:"Dark Slate",rgb:[51,57,65]},{id:59,name:"Slate",rgb:[109,117,141]},{id:60,name:"Light Slate",rgb:[179,185,209]},{id:61,name:"Dark Stone",rgb:[109,100,63]},{id:62,name:"Stone",rgb:[148,140,107]},{id:63,name:"Light Stone",rgb:[205,197,158]}],Y=new Map;for(let e of k)e.id!==0&&Y.set(e.rgb.join(","),e);function Be(e,t,o,n){if(n===0)return k[0];let a=Y.get(e+","+t+","+o);if(a)return a;let c=k[1],s=1/0;for(let i of k){if(i.id===0)continue;let d=(e-i.rgb[0])**2+(t-i.rgb[1])**2+(o-i.rgb[2])**2;d<s&&(s=d,c=i)}return c}X.exports={COLOR_PALETTE:k,matchColor:Be}});var ae=f((ut,oe)=>{var{matchColor:J}=N(),Q=1e3,Ie="https://backend.wplace.live/files/s0/tiles",E=new Map,F=document.createElement("canvas"),Z=F.getContext("2d",{willReadFrequently:!0});function ee(e,t){return Ie+"/"+e+"/"+t+".png"}function Ae(e){return fetch(e,{credentials:"omit"}).then(t=>{if(t.status===404)return null;if(!t.ok)throw new Error("HTTP "+t.status+" for "+e);return t.blob()})}async function te(e,t){let o=e+","+t;if(E.has(o))return E.get(o);let n=await Ae(ee(e,t));if(n===null)return E.set(o,null),null;let a=await createImageBitmap(n);F.width=a.width,F.height=a.height,Z.drawImage(a,0,0);let c=Z.getImageData(0,0,a.width,a.height);return a.close&&a.close(),E.set(o,c),c}async function ne(e,t,o,n){let a=await te(e,t);if(!a)return J(0,0,0,0);let c=(n*a.width+o)*4;return J(a.data[c],a.data[c+1],a.data[c+2],a.data[c+3])}async function Re(e,t,o,n,a){let c=[],s=e,i=o;for(let d=0;d<a;d++){let p=await ne(s,t,i,n);c.push(p.id),i++,i>=Q&&(i=0,s++)}return c}oe.exports={TILE_SIZE:Q,tileUrl:ee,getTileImageData:te,readPixel:ne,readSequenceHorizontal:Re}});var ie=f((gt,re)=>{var{COLOR_PALETTE:ce}=N();function qe(e){let t=document.createElement("canvas");t.width=e.length,t.height=1;let o=t.getContext("2d"),n=o.createImageData(e.length,1);for(let a=0;a<e.length;a++){let c=ce[e[a]]||ce[1];n.data[a*4]=c.rgb[0],n.data[a*4+1]=c.rgb[1],n.data[a*4+2]=c.rgb[2],n.data[a*4+3]=e[a]===0?0:255}return o.putImageData(n,0,0),new Promise((a,c)=>{t.toBlob(s=>s?a(s):c(new Error("toBlob failed")),"image/png")})}re.exports={sequenceToPngBlob:qe}});var ue=f((pt,le)=>{var se="template-overlays",Oe="wplace-templates",$="images";function de(){return JSON.parse(localStorage.getItem(se)||"[]")}function Me(){let e=new URLSearchParams(location.search),t=parseFloat(e.get("lat"))||58.34,o=parseFloat(e.get("lng"))||14.03;return{north:t+.001,south:t-.001,west:o-.001,east:o+.001}}function Ne(e,t){return new Promise((o,n)=>{let a=indexedDB.open(Oe);a.onerror=()=>n(a.error),a.onsuccess=()=>{let c=a.result;if(!c.objectStoreNames.contains($))return c.close(),n(new Error('IDB store "images" not found'));let s=c.transaction($,"readwrite");s.objectStore($).put(t,e),s.oncomplete=()=>{c.close(),o()},s.onerror=()=>{c.close(),n(s.error)}}})}async function Fe(e,t,o={}){let n=await createImageBitmap(e),a=n.width,c=n.height;n.close&&n.close();let s=crypto.randomUUID();await Ne(s,e);let i={id:s,name:t,bounds:o.bounds||Me(),originalWidth:a,originalHeight:c,opacity:o.opacity!==void 0?o.opacity:.5,visible:!0,locked:!1,colorMetric:"lab",dithering:!1,useLegacyColors:!1,colorPaletteMode:"all",order:0,hasPlaced:!1,updatedAt:Date.now()},d=()=>{let p=de();p.some(P=>P.id===s)||(p.push(i),localStorage.setItem(se,JSON.stringify(p)))};return d(),window.addEventListener("pagehide",d),i}le.exports={injectTemplate:Fe,listOverlays:de}});var he=f((bt,me)=>{var{ALPHABET:$e}=R(),pe="colorcoder-gui-state",ge={x:20,y:20,collapsed:!1,tab:"encode",settings:{autoReload:!1,consoleLogs:!0}};function He(){try{return Object.assign({},ge,JSON.parse(localStorage.getItem(pe)||"{}"))}catch{return{...ge}}}function x(e){localStorage.setItem(pe,JSON.stringify(e))}var r=He(),u,y,g,L,b,m,h,S,T,D,H=null;function je(){return`
        #cc-panel {
            position: fixed; z-index: 999999;
            width: 320px; background: #1a1a1d; color: #e0e0e0;
            border: 1px solid #444; border-radius: 6px;
            font-family: monospace; font-size: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex; flex-direction: column;
        }
        #cc-header {
            padding: 6px 10px; background: #2a2a2e; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #444; border-radius: 6px 6px 0 0;
            user-select: none;
        }
        #cc-header .title { font-weight: bold; color: #7fffd4; letter-spacing: 1px; }
        #cc-header .btns button {
            background: transparent; border: none; color: #aaa; cursor: pointer;
            font-size: 14px; margin-left: 8px; padding: 0 4px;
        }
        #cc-header .btns button:hover { color: #fff; }
        #cc-body { padding: 10px; display: ${r.collapsed?"none":"block"}; }
        .cc-tabs { display: flex; margin-bottom: 10px; border-bottom: 1px solid #444; }
        .cc-tabs button {
            background: transparent; border: none; color: #888; padding: 4px 10px;
            cursor: pointer; font-family: inherit; font-size: 12px;
        }
        .cc-tabs button.active { color: #7fffd4; border-bottom: 2px solid #7fffd4; }
        .cc-pane { display: none; }
        .cc-pane.active { display: block; }
        .cc-row { margin-bottom: 8px; }
        .cc-row label { display: block; margin-bottom: 3px; color: #aaa; }
        .cc-row input[type=text], .cc-row textarea, .cc-row select {
            width: 100%; box-sizing: border-box; background: #0f0f11; color: #fff;
            border: 1px solid #444; padding: 6px; font-family: inherit; border-radius: 3px;
        }
        .cc-row textarea { height: 60px; resize: vertical; }
        .cc-btn {
            background: #7fffd4; color: #000; border: none; padding: 6px 12px;
            cursor: pointer; font-weight: bold; border-radius: 3px; width: 100%;
        }
        .cc-btn:disabled { background: #555; color: #999; cursor: not-allowed; }
        .cc-status {
            margin-top: 8px; padding: 6px; border-radius: 3px; font-size: 11px;
            display: none;
        }
        .cc-status.info { display: block; background: #2c3e50; color: #fff; }
        .cc-status.success { display: block; background: #27ae60; color: #fff; }
        .cc-status.error { display: block; background: #c0392b; color: #fff; }
        .cc-warn { color: #e74c3c; font-size: 11px; margin-top: 4px; }
        .cc-decode-result {
            background: #0f0f11; padding: 8px; border-radius: 3px; 
            margin-bottom: 8px; word-break: break-all; border: 1px solid #333;
        }
        .cc-meta { font-size: 10px; color: #888; margin-bottom: 4px; }
        .cc-shield { position: fixed; inset: 0; z-index: 999998; cursor: move; }
    `}function ze(){let e=document.createElement("style");e.textContent=je(),document.head.appendChild(e),u=document.createElement("div"),u.id="cc-panel",u.style.left=r.x+"px",u.style.top=r.y+"px",y=document.createElement("div"),y.id="cc-header",y.innerHTML=`
        <span class="title">COLORCODER</span>
        <span class="btns">
            <button id="cc-collapse" title="Collapse">_</button>
            <button id="cc-close" title="Hide (Alt+C)">x</button>
        </span>
    `,u.appendChild(y),g=document.createElement("div"),g.id="cc-body";let t=document.createElement("div");t.className="cc-tabs",t.innerHTML=`
        <button data-tab="encode" class="${r.tab==="encode"?"active":""}">Encode</button>
        <button data-tab="decode" class="${r.tab==="decode"?"active":""}">Decode</button>
        <button data-tab="settings" class="${r.tab==="settings"?"active":""}">Settings</button>
    `,g.appendChild(t),b=document.createElement("div"),b.className=`cc-pane ${r.tab==="encode"?"active":""}`,b.dataset.tab="encode",b.innerHTML=`
        <div class="cc-row">
            <label>Protocol: V1</label>
            <select id="cc-mode">
                <option value="0">Lite (basic chars, 1px/char)</option>
                <option value="1">Full (UTF-8, 4px/3bytes)</option>
            </select>
        </div>
        <div class="cc-row">
            <label>Message Text</label>
            <textarea id="cc-text" placeholder="Type message..."></textarea>
            <div id="cc-litewarn" class="cc-warn" style="display:none;"></div>
        </div>
        <button id="cc-encode" class="cc-btn">Create Wplace Overlay</button>
    `,g.appendChild(b),m=document.createElement("div"),m.className=`cc-pane ${r.tab==="decode"?"active":""}`,m.dataset.tab="decode",m.innerHTML=`
        <div class="cc-row" style="color:#888; font-size:11px; margin-bottom:10px;">
            Alt+Click a Black sync pixel on the canvas to decode.
        </div>
        <div id="cc-decode-empty" style="color:#555; text-align:center; padding:20px;">
            No messages decoded yet.
        </div>
        <div id="cc-decode-content" style="display:none;"></div>
    `,g.appendChild(m),h=document.createElement("div"),h.className=`cc-pane ${r.tab==="settings"?"active":""}`,h.dataset.tab="settings",h.innerHTML=`
        <div class="cc-row">
            <label><input type="checkbox" id="cc-autoreload" ${r.settings.autoReload?"checked":""}> Auto reload after overlay injection</label>
        </div>
        <div class="cc-row">
            <label><input type="checkbox" id="cc-logs" ${r.settings.consoleLogs?"checked":""}> Show console logs</label>
        </div>
        <button id="cc-reset" class="cc-btn" style="background:#555; color:#fff;">Reset Panel Position</button>
    `,g.appendChild(h),L=document.createElement("div"),L.className="cc-status",g.appendChild(L),u.appendChild(g),document.documentElement.appendChild(u),Ue()}function Ue(){g.querySelectorAll(".cc-tabs button").forEach(n=>{n.addEventListener("click",()=>{r.tab=n.dataset.tab,g.querySelectorAll(".cc-tabs button").forEach(a=>a.classList.remove("active")),n.classList.add("active"),g.querySelectorAll(".cc-pane").forEach(a=>a.classList.remove("active")),g.querySelector(`.cc-pane[data-tab="${r.tab}"]`).classList.add("active"),x(r)})}),y.querySelector("#cc-collapse").addEventListener("click",()=>{r.collapsed=!r.collapsed,g.style.display=r.collapsed?"none":"block",y.querySelector("#cc-collapse").textContent=r.collapsed?"+":"_",x(r)}),y.querySelector("#cc-close").addEventListener("click",()=>{u.style.display="none"});let e=null;y.addEventListener("mousedown",n=>{if(n.target.closest("button"))return;let a=document.createElement("div");a.className="cc-shield",document.body.appendChild(a),e={startX:n.clientX-r.x,startY:n.clientY-r.y,shield:a},n.preventDefault()}),document.addEventListener("mousemove",n=>{e&&(r.x=Math.max(0,Math.min(window.innerWidth-100,n.clientX-e.startX)),r.y=Math.max(0,Math.min(window.innerHeight-50,n.clientY-e.startY)),u.style.left=r.x+"px",u.style.top=r.y+"px")}),document.addEventListener("mouseup",()=>{e&&(e.shield.remove(),e=null,x(r))}),D=b.querySelector("#cc-mode"),T=b.querySelector("#cc-text"),S=b.querySelector("#cc-encode");let t=b.querySelector("#cc-litewarn");function o(){if(D.value==="0"){let n=T.value,a=[];for(let c of n)!$e.includes(c)&&!a.includes(c)&&a.push(c);a.length>0?(t.style.display="block",t.textContent=`Lite cannot encode: ${a.join(", ")}. Use Full.`,S.disabled=!0):(t.style.display="none",S.disabled=!1)}else t.style.display="none",S.disabled=!1}D.addEventListener("change",o),T.addEventListener("input",o),o(),S.addEventListener("click",()=>{H&&H(T.value,parseInt(D.value,10))}),h.querySelector("#cc-autoreload").addEventListener("change",n=>{r.settings.autoReload=n.target.checked,x(r)}),h.querySelector("#cc-logs").addEventListener("change",n=>{r.settings.consoleLogs=n.target.checked,x(r)}),h.querySelector("#cc-reset").addEventListener("click",()=>{r.x=20,r.y=20,u.style.left="20px",u.style.top="20px",x(r)})}function be(){document.getElementById("cc-panel")||ze()}function Ge(){u&&(u.style.display="flex")}function _e(){u?u.style.display=u.style.display==="none"?"flex":"none":be()}function fe(e,t="info"){L.textContent=e,L.className="cc-status "+t}function Ve(e){H=e}function We(e,t){let o=m.querySelector("#cc-decode-empty"),n=m.querySelector("#cc-decode-content");o.style.display="none",n.style.display="block";let a=e.mode===0?"Lite":"Full",c=e.valid?"CRC OK":`CRC WARNING (Stored: ${e.storedChecksum} != Computed: ${e.computedChecksum})`,s=t?`Tile: ${t.tileX},${t.tileY} | Px: ${t.px},${t.py}`:"",i="";e.badChars&&(i+='<div class="cc-warn">Warning: Payload contains unmapped chars (replaced with "?")</div>'),e.badPadding&&(i+='<div class="cc-warn">Warning: Non-zero padding bits (possible corruption)</div>'),e.truncated&&(i+='<div class="cc-warn">Warning: Message truncated (sequence too short)</div>'),n.innerHTML=`
        <div class="cc-meta">${a} | ${e.length} px | ${c}</div>
        <div class="cc-meta">${s}</div>
        ${i}
        <div class="cc-decode-result">${Ke(e.text||"")}</div>
        <button id="cc-copy" class="cc-btn" style="background:#555; color:#fff; margin-top:4px;">Copy Text</button>
    `,n.querySelector("#cc-copy").addEventListener("click",()=>{navigator.clipboard.writeText(e.text||"").then(()=>{fe("Copied to clipboard","success")})}),r.tab="decode",g.querySelectorAll(".cc-tabs button").forEach(d=>d.classList.remove("active")),g.querySelector('.cc-tabs button[data-tab="decode"]').classList.add("active"),g.querySelectorAll(".cc-pane").forEach(d=>d.classList.remove("active")),m.classList.add("active"),x(r)}function Ke(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}me.exports={init:be,show:Ge,toggle:_e,setStatus:fe,onEncode:Ve,showDecodeResult:We,getSettings:()=>r.settings}});var{encodeV1:Ye,decodeV1:Xe,unpackHeader:Je,VERSION:Ze}=K(),{readSequenceHorizontal:ye,readPixel:Qe}=ae(),{sequenceToPngBlob:et}=ie(),{injectTemplate:tt}=ue(),l=he(),nt=window.fetch;window.fetch=async function(...e){let t=await nt.apply(this,e);try{let o=typeof e[0]=="string"?e[0]:e[0]&&e[0].url||"";if(o.includes("/pixel/")){let n=o.split("?")[0].split("/").filter(Boolean),a=parseInt(n[n.length-1],10),c=parseInt(n[n.length-2],10),s=new URLSearchParams(o.split("?")[1]||""),i=parseInt(s.get("x"),10),d=parseInt(s.get("y"),10);[c,a,i,d].every(p=>!isNaN(p))&&window.dispatchEvent(new CustomEvent("cc-click",{detail:{tileX:c,tileY:a,px:i,py:d}}))}}catch{}return t};async function ot(e,t,o,n){let a=await ye(e,t,o,n,4);if(a[0]!==1){let p=await Qe(e,t,o,n);l.getSettings().consoleLogs&&console.log("[CC] Not a sync pixel (id "+p.id+" "+p.name+"), nothing to decode here.");return}let c=Je(a[1],a[2],a[3]);if(c.version!==Ze){l.getSettings().consoleLogs&&console.warn("[CC] Unknown header version "+c.version+", cannot decode yet."),l.setStatus("Unknown V"+c.version+" protocol. Cannot decode.","error");return}let s=await ye(e,t,o,n,4+c.length),i=Xe(s);if(!i)return;let d=i.mode===0?"Lite":"Full";l.getSettings().consoleLogs&&(i.valid?console.log("%c[CC] Decoded "+d+" message ("+i.length+" px, crc OK)","color:#0c8;font-weight:bold"):console.log("%c[CC] Decoded "+d+" message ("+i.length+" px) - CORRUPTED","color:#c80;font-weight:bold"),console.log(i.text)),l.showDecodeResult(i,{tileX:e,tileY:t,px:o,py:n})}var j={alt:!1,t:0};document.addEventListener("click",e=>{j={alt:e.altKey,t:Date.now()}},!0);window.addEventListener("cc-click",e=>{if(!j.alt||Date.now()-j.t>2e3)return;let{tileX:t,tileY:o,px:n,py:a}=e.detail;ot(t,o,n,a).catch(c=>{console.error("[CC] Decode error:",c),l.setStatus("Decode error: "+c.message,"error")})});function at(e){return e&&(e.tagName==="INPUT"||e.tagName==="TEXTAREA"||e.isContentEditable)}async function ve(e,t){l.setStatus("Encoding and generating PNG...","info");let o=Ye(e,t);if(!o){l.setStatus("Encode failed - check text and mode.","error");return}try{let n=await et(o.fullSequence),a="CC "+(t?"full":"lite")+": "+e.slice(0,24);if(await tt(n,a),l.setStatus("Overlay injected: "+a,"success"),l.getSettings().consoleLogs&&console.log('%c[CC] Injected "'+a+'" ('+o.length+" px).","color:#0c8;font-weight:bold"),l.getSettings().autoReload)l.setStatus("Reloading page...","info"),setTimeout(()=>location.reload(),500);else{let c=document.createElement("button");c.textContent="Reload Now",c.style.cssText="margin-top:6px; background:#7fffd4; color:#000; border:none; padding:4px 8px; cursor:pointer; font-weight:bold; width:100%; border-radius:3px;",c.onclick=()=>location.reload(),document.querySelector(".cc-status").appendChild(c)}}catch(n){console.error("[CC] Inject failed:",n),l.setStatus("Inject failed: "+n.message,"error")}}async function ct(){let e=(prompt("Mode: l = Lite (basic chars), f = Full (any UTF-8)","l")||"").trim().toLowerCase();if(!e)return;let t=e.startsWith("f")?1:0,o=prompt("Message text:");o&&await ve(o,t)}document.addEventListener("keydown",e=>{e.altKey&&(at(e.target)||(e.code==="KeyM"&&ct().catch(t=>{console.error("[CC] Inject failed:",t),l.setStatus("Inject failed: "+t.message,"error")}),e.code==="KeyC"&&l.toggle()))});function xe(){l.init(),l.onEncode(ve),l.getSettings().consoleLogs&&console.log("%c[CC] Ready. Alt+Click = decode, Alt+M = legacy encode, Alt+C = toggle GUI.","color:#0af;font-weight:bold")}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",xe):xe();})();
