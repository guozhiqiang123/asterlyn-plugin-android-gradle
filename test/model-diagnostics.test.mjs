import assert from "node:assert/strict";
import test from "node:test";
import {createModelDiagnosticReader,modelFailureCode,modelFailureRecord} from "../server-programs/model-diagnostics.mjs";
import {availableRepositoryEnvironment} from "../server-programs/model-environment.mjs";
import {requestedModelSelection} from "../server-programs/model-selection.mjs";
test("an unopened task panel permits automatic AGP selection while explicit variants remain strict",()=>{
 for(const empty of [undefined,null,""])assert.deepEqual(requestedModelSelection(empty),{module:"",variant:""});
 assert.deepEqual(requestedModelSelection("android-run::app:installCleanx100Debug"),{module:":app",variant:"cleanx100Debug"});
 assert.throws(()=>requestedModelSelection("stale-config"),/unsupported-run-configuration/u);
 assert.throws(()=>requestedModelSelection({variant:"debug"}),/unsupported-run-configuration/u);
});
test("missing environment cannot override valid project Gradle properties with empty credentials",()=>{
 assert.deepEqual(availableRepositoryEnvironment({}),{});
 assert.deepEqual(availableRepositoryEnvironment({NEXUS_USER:"",NEXUS_PASSWORD:""}),{});
 assert.deepEqual(availableRepositoryEnvironment({ASTERLYN_NEXUS_USERNAME:"configured",NEXUS_USER:"other"}),{});
 assert.deepEqual(availableRepositoryEnvironment({ASTERLYN_NEXUS_USERNAME:"",NEXUS_USER:"other"}),{});
 assert.deepEqual(availableRepositoryEnvironment({NEXUS_USER:"configured",NEXUS_PASSWORD:"configured-password"}),{ASTERLYN_NEXUS_USERNAME:"configured",ASTERLYN_NEXUS_PASSWORD:"configured-password"});
});
test("chunked fixed records preserve safe causes and location while arbitrary stderr is discarded",()=>{
 const reader=createModelDiagnosticReader();for(const chunk of ["password=do-not-log\nMODEL_FAIL","URE org.gradle.tooling.BuildActionFailureException javax.net.ssl.SSLHandshakeException\nMODEL_CODE dependency-","tls\nMODEL_LOCATION build.gradle:17\n"] )reader.feed(chunk);
 const e=reader.snapshot();assert.equal(e.causeClass,"javax.net.ssl.SSLHandshakeException");assert.equal(e.failureCode,"dependency-tls");assert.equal(e.sourceLine,17);assert.ok(!JSON.stringify(e).includes("do-not-log"));
 const ordinary=modelFailureRecord(e,performance.now());assert.equal(ordinary.errorCode,"dependency-tls");assert.equal(ordinary.sourceFile,undefined);assert.equal(ordinary.causeChain,undefined);
 const debug=modelFailureRecord(e,performance.now(),true);assert.equal(debug.sourceFile,"build.gradle");assert.ok(Buffer.byteLength(JSON.stringify(debug))<512);
});
test("malformed tool messages cannot turn into source, paths, credentials or unbounded cause records",()=>{
 const reader=createModelDiagnosticReader();reader.feed("MODEL_FAILURE Authorization: secret\nMODEL_CODE credential-secret\nMODEL_LOCATION /private/project/build.gradle:5\n"+"x".repeat(8000)+"\n");
 assert.equal(reader.snapshot().causeClass,undefined);assert.equal(reader.snapshot().failureCode,undefined);assert.equal(reader.snapshot().sourceFile,undefined);
 assert.equal(modelFailureCode({causeChain:"org.gradle.api.ProjectConfigurationException>org.gradle.api.GradleException"}),"project-configuration-failed");
 assert.equal(modelFailureCode({message:"source-never-logged"}),"model-unavailable");
});
