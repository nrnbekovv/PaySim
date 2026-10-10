// Optional offline build using an existing dependency directory. Normal setup uses npm + Vite.
const path=require('node:path');
const fs=require('node:fs');
const root=process.env.PAYSIM_DEPENDENCIES || path.resolve('node_modules');
const esbuild=require(path.join(root,'esbuild'));
const env={};
for(const name of ['.env','.env.local'])if(fs.existsSync(name))for(const line of fs.readFileSync(name,'utf8').split(/\r?\n/)){const m=line.match(/^(VITE_\w+)=(.*)$/);if(m)env[m[1]]=m[2];}
fs.mkdirSync('dist',{recursive:true});
fs.copyFileSync('public/favicon.svg','dist/favicon.svg');
fs.writeFileSync('dist/index.html',fs.readFileSync('index.html','utf8').replace('<script type="module" src="/src/main.tsx"></script>','<link rel="stylesheet" href="/app.css"/><script type="module" src="/app.js"></script>'));
// Resolve/read through Node on restricted Windows hosts where Go's ancestor-directory
// enumeration fails even though the individual workspace files are readable.
const resolver={name:'node-files',setup(build){
 const resolveFile=p=>{for(const f of [p,p+'.ts',p+'.tsx',p+'.js',p+'.jsx',p+'.json',path.join(p,'index.ts'),path.join(p,'index.js')]){try{if(fs.statSync(f).isFile())return f;}catch{}}return require.resolve(p);};
 const browserFile=p=>{let dir=path.dirname(p);while(dir.length>3){const manifest=path.join(dir,'package.json');if(fs.existsSync(manifest)){const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));const relative='./'+path.relative(dir,p).split(path.sep).join('/');if(typeof pkg.browser==='string'&&(relative==='./'+pkg.main||relative==='./'+pkg.module))return path.resolve(dir,pkg.browser);if(pkg.browser&&typeof pkg.browser==='object'&&relative in pkg.browser)return pkg.browser[relative]===false?'EMPTY':path.resolve(dir,pkg.browser[relative]);return p;}dir=path.dirname(dir);}return p;};
 build.onResolve({filter:/.*/},args=>{if(args.path.startsWith('https:'))return {path:args.path,external:true};if(args.path==='node:crypto')return {path:'EMPTY',namespace:'node-files'};let resolved;if(path.isAbsolute(args.path))resolved=resolveFile(args.path);else if(args.path.startsWith('.'))resolved=resolveFile(path.resolve(path.dirname(args.importer),args.path));else resolved=require.resolve(args.path==='buffer'?'buffer/':args.path,{paths:[root,args.importer?path.dirname(args.importer):process.cwd()]});if(resolved.endsWith('cryptoNode.js')&&resolved.includes('@noble'))resolved=resolved.replace('cryptoNode.js','crypto.js');resolved=browserFile(resolved);return {path:resolved,namespace:'node-files'};});
 build.onLoad({filter:/.*/,namespace:'node-files'},args=>{if(args.path==='EMPTY')return {contents:'module.exports={}',loader:'js'};const ext=path.extname(args.path).slice(1);return {contents:fs.readFileSync(args.path,'utf8'),loader:({tsx:'tsx',ts:'ts',css:'css',json:'json'})[ext]||'js',resolveDir:path.dirname(args.path)};});
}};
esbuild.build({entryPoints:[path.resolve('src/main.tsx')],bundle:true,outfile:'dist/app.js',nodePaths:[root],plugins:[resolver],write:false,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,sourcemap:true,define:{'import.meta.env':JSON.stringify(env),'process.env.NODE_ENV':'"production"','global':'globalThis'}}).then(result=>{for(const file of result.outputFiles)fs.writeFileSync(file.path,file.contents);console.log('PaySim built to dist/ using locally available dependencies.');}).catch(()=>process.exit(1));
