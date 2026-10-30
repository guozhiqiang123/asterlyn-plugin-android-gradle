/** Missing run-task UI state permits an AGP-authoritative default; explicit choices never fall back. */
export function requestedModelSelection(configuration){
 if(configuration===undefined||configuration===null||configuration==="")return{module:"",variant:""};
 if(typeof configuration!=="string")throw Error("unsupported-run-configuration");
 const match=/^android-run::(?:(.+):)?install([A-Za-z0-9][A-Za-z0-9_.-]{0,159})$/u.exec(configuration);
 if(!match)throw Error("unsupported-run-configuration");
 return{module:!match[1]?":":`:${match[1].replace(/\./gu,":")}`,variant:`${match[2][0].toLowerCase()}${match[2].slice(1)}`};
}
