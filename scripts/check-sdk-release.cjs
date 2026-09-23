// Fail closed: source builds alone must never label a firmware target supported.
const fs=require('node:fs'),{execFileSync}=require('node:child_process')
const required=['authentication','encryption','receipt-loss','duplicate','offline-queue','power-cut','credential-rotation','reconnect','queue-full','command-dedup','command-power-cut']
function check(evidence,commit){
 if(evidence.commit!==commit||evidence.version!=='0.2.0')throw new Error('Evidence must match exact release commit/version')
 if(!Array.isArray(evidence.rigs)||!evidence.rigs.length)throw new Error('Physical hardware evidence is required')
 for(const rig of evidence.rigs){
  if(!rig.board||!rig.compiler||!rig.platformSdk||!rig.firmwareSha256?.match(/^[a-f0-9]{64}$/)||!rig.report||rig.physical!==true)throw new Error('Incomplete rig identity')
  for(const test of required)if(rig.tests?.[test]!=='passed')throw new Error(`${rig.board}: ${test} not passed`)
  if(!Number.isFinite(rig.stackHighWaterBytes)||!Number.isFinite(rig.heapPeakBytes))throw new Error('Measured resource evidence missing')
 }
 if(!evidence.registryOwnershipVerified||!evidence.licenseApproved||!evidence.securityContactVerified)throw new Error('Publishing ownership/license/security contact unresolved')
 return true
}
if(require.main===module){try{const file=process.argv[2];if(!file)throw new Error('Usage: node scripts/check-sdk-release.cjs evidence.json');check(JSON.parse(fs.readFileSync(file,'utf8')),execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());console.log('Release evidence complete; publish only the listed hardware targets.')}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={check}
