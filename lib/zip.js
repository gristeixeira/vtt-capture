// Formato ZIP sem compressão, compatível com unzip/Windows/macOS; sem dependências.
const utf8 = s => new TextEncoder().encode(s);
const table = (() => { const t=[]; for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t; })();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function w16(v,p,n){v[p]=n&255;v[p+1]=(n>>>8)&255;}
function w32(v,p,n){w16(v,p,n);w16(v,p+2,n>>>16);}
function dosDateTime(d=new Date()){let y=Math.max(1980,d.getFullYear());return {date:((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate(),time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2)};}
export function createZip(files){
  const entries=[]; const parts=[];let offset=0;const {date,time}=dosDateTime();
  for(const [filename,content] of Object.entries(files)){
    const name=utf8(filename),bytes=utf8(content),crc=crc32(bytes),head=new Uint8Array(30+name.length);
    w32(head,0,0x04034b50);w16(head,4,20);w16(head,6,0x0800);w16(head,8,0);w16(head,10,time);w16(head,12,date);
    w32(head,14,crc);w32(head,18,bytes.length);w32(head,22,bytes.length);w16(head,26,name.length);head.set(name,30);
    parts.push(head,bytes);entries.push({name,bytes,crc,offset});offset+=head.length+bytes.length;
  }
  const centralOffset=offset;
  for(const e of entries){const head=new Uint8Array(46+e.name.length);
    w32(head,0,0x02014b50);w16(head,4,20);w16(head,6,20);w16(head,8,0x0800);w16(head,10,0);w16(head,12,time);w16(head,14,date);
    w32(head,16,e.crc);w32(head,20,e.bytes.length);w32(head,24,e.bytes.length);w16(head,28,e.name.length);w32(head,42,e.offset);head.set(e.name,46);
    parts.push(head);offset+=head.length;
  }
  const tail=new Uint8Array(22);w32(tail,0,0x06054b50);w16(tail,8,entries.length);w16(tail,10,entries.length);
  w32(tail,12,offset-centralOffset);w32(tail,16,centralOffset);parts.push(tail);offset+=tail.length;
  const buf=new Uint8Array(offset);let p=0;for(const part of parts){buf.set(part,p);p+=part.length;}
  return buf;
}
export function binaryBase64(bytes){
  let out='';const size=16384;for(let i=0;i<bytes.length;i+=size)out+=String.fromCharCode(...bytes.subarray(i,i+size));return btoa(out);
}
