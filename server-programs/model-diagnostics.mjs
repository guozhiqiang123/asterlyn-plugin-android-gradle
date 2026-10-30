const CLASS=/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;
const CODES=new Set(["android-sdk-missing","repository-credentials-missing","dependency-unavailable","dependency-tls","dependency-dns","gradle-model-incompatible","gradle-version-incompatible","gradle-toolchain-incompatible","project-configuration-failed","project-script-failed","model-selection-unavailable","model-artifact-missing","model-path-missing","program-failed","program-timeout","cancelled","output-bound","model-invalid","model-json-invalid","request-schema","unsupported-run-configuration","model-unavailable"]);
export function modelFailureCode(error){
  if(CODES.has(error?.failureCode))return error.failureCode;
  if(CODES.has(error?.message))return error.message;
  const chain=String(error?.causeChain??"");
  if(/SSLHandshakeException|SSLPeerUnverifiedException|CertPathBuilderException/u.test(chain))return "dependency-tls";
  if(/UnknownHostException/u.test(chain))return "dependency-dns";
  if(/ModuleVersionNotFoundException|ModuleVersionResolveException|ArtifactResolveException/u.test(chain))return "dependency-unavailable";
  if(/UnsupportedMethodException|UnknownModelException/u.test(chain))return "gradle-model-incompatible";
  if(/ProjectConfigurationException|GradleScriptException/u.test(chain))return "project-configuration-failed";
  return "model-unavailable";
}
/** Stream only fixed diagnostic records; all other tool output is discarded, even during debugging. */
export function createModelDiagnosticReader(){
  let partial="",classes=[],failureCode,sourceFile,sourceLine;
  const line=value=>{
    const failure=/^MODEL_FAILURE (.+)$/u.exec(value);
    if(failure){const parts=failure[1].split(" ");if(parts.length<=8&&parts.every(v=>v.length<=160&&CLASS.test(v)))classes=parts;}
    const code=/^MODEL_CODE ([a-z][a-z0-9.-]{0,79})$/u.exec(value);if(code&&CODES.has(code[1]))failureCode=code[1];
    const location=/^MODEL_LOCATION ([A-Za-z0-9._-]{1,80}\.gradle(?:\.kts)?):(\d{1,7})$/u.exec(value);
    if(location&&Number(location[2])>0&&Number(location[2])<=1_000_000){sourceFile=location[1];sourceLine=Number(location[2]);}
  };
  return{feed(chunk){for(const char of String(chunk)){if(char==="\n"){line(partial.replace(/\r$/u,""));partial="";}else if(partial.length<2048)partial+=char;else partial="invalid";}},snapshot(){return{causeChain:classes.length?classes.join(">"):undefined,causeClass:classes.at(-1),failureCode,sourceFile,sourceLine};}};
}
export function modelFailureRecord(error,started,debug=false){
  const record={stage:"error",count:0,durationMs:Math.round(performance.now()-started),errorCode:modelFailureCode(error)};
  const classes=String(error?.causeChain??"").split(">").filter(value=>value.length<=160&&CLASS.test(value));
  if(classes.length)record.causeClass=classes.at(-1);
  if(debug){
    if(classes.length)record.causeChain=[classes[0],...(classes.length>1?[classes.at(-1)]:[])].join(">").slice(0,160);
    if(/^[A-Za-z0-9._-]{1,80}\.gradle(?:\.kts)?$/u.test(error?.sourceFile??"")){record.sourceFile=error.sourceFile;record.sourceLine=error.sourceLine;}
  }
  // The native generic worker accepts at most 512 bytes per diagnostic line.
  if(Buffer.byteLength(JSON.stringify(record))>480){delete record.causeChain;delete record.sourceFile;delete record.sourceLine;}
  return record;
}
