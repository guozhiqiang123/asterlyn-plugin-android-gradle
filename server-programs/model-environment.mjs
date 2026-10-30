/** Absence is distinct from an explicitly configured property. Never invent empty -P overrides. */
export function availableRepositoryEnvironment(environment){
 const result={};
 for(const [destination,candidates] of [["ASTERLYN_NEXUS_USERNAME",["NEXUS_USER","NEXUS_USERNAME"]],["ASTERLYN_NEXUS_PASSWORD",["NEXUS_PASSWORD"]]]){
  if(Object.hasOwn(environment,destination))continue;
  const value=candidates.map(key=>environment[key]).find(value=>typeof value==="string"&&value.length>0);
  if(value!==undefined)result[destination]=value;
 }
 return result;
}
