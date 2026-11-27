const o = require(process.argv[2]);
console.log('errors:', o.errors.length, o.errors.slice(0, 4));
console.log('images:', JSON.stringify(o.images));
for (const v of Object.keys(o.phases)) { const P = o.phases[v]; console.log('==', v);
  for (const k of Object.keys(P)) { const x = P[k]; console.log(' ', k.padEnd(40), x && x.by ? `total=${x.total} ids=${x.idsSent} ${JSON.stringify(x.by)}` : JSON.stringify(x)); } }
