// Render the actual React component without a browser. This is a smoke test, not visual QA.
const path=require('node:path'),fs=require('node:fs'),Module=require('node:module'),assert=require('node:assert/strict');
const dependencies=process.env.PAYSIM_DEPENDENCIES||path.resolve('node_modules');
const ts=require(path.join(dependencies,'typescript'));
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){if(!name.startsWith('.')&&!path.isAbsolute(name)&&!Module.isBuiltin(name)){try{return originalResolve.call(this,name,{...parent,paths:[dependencies]},...rest);}catch{}}return originalResolve.call(this,name,parent,...rest);};
require.extensions['.tsx']=require.extensions['.ts']=function(module,file){const source=fs.readFileSync(file,'utf8').replaceAll('import.meta.env','({})');module._compile(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);};
global.localStorage={getItem:()=>null};
const React=require('react'),{renderToString}=require('react-dom/server');
const App=require('../src/App.tsx').default;
const html=renderToString(React.createElement(App));
for(const text of ['PaySim','Clarity before every action.','Run simulation','8,500.00','170,000','Alice','Bob','Charlie','Not yet validated'])assert.ok(html.includes(text),`Missing UI content: ${text}`);
assert.ok(html.includes('disabled=""'), 'Unvalidated settlement must be disabled');
console.log(`React UI smoke test passed (${html.length} characters rendered).`);
