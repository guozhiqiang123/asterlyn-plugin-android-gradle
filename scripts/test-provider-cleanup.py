# macOS/Linux opt-in real process-tree regression; only creates/kills its own processes.
from pathlib import Path
import tempfile,subprocess,sys,os,json,time,signal
root=Path(__file__).resolve().parents[1]; node=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]);results=[]
for mode in ['native-exit','overflow','timeout']:
 with tempfile.TemporaryDirectory(prefix='asterlyn-provider-') as directory:
  w=Path(directory);(w/'gradle/wrapper').mkdir(parents=True);(w/'gradle/wrapper/gradle-wrapper.properties').write_text('distributionUrl=https://services.gradle.org/distributions/gradle-8.13-bin.zip\n');j=w/'jdk';j.mkdir();pidfile=w/'children.json'
  code='''import os,signal,subprocess,sys,time,json
signal.signal(signal.SIGTERM,signal.SIG_IGN)
child=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(90)'])
open(PIDFILE,'w').write(json.dumps([os.getpid(),child.pid]))
if MODE=='overflow':sys.stdout.write('x'*(17*1024*1024));sys.stdout.flush()
time.sleep(90)
'''.replace('PIDFILE',repr(str(pidfile))).replace('MODE',repr(mode))
  for name in ['java','javac']:
   f=j/name;f.write_text('#!'+sys.executable+'\n'+code);f.chmod(0o700)
  request={'protocolVersion':1,'workspaceRoot':str(w),'tools':{'gradleJava':{'home':str(j),'java':str(j/'java'),'javac':str(j/'javac'),'major':17,'digest':'sha256:test'}},'components':{},'state':{'runConfiguration':'android-run::app:installDemoDebug'},'inputDigest':'sha256:test'}
  env={k:v for k,v in os.environ.items() if k in ['HOME','TMPDIR','USERPROFILE','SystemRoot']};env['PATH']=str(node.parent)
  began=time.time();p=subprocess.Popen([str(node),str(root/'server-programs/model.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True);p.stdin.write(json.dumps(request).encode());p.stdin.close()
  until=time.time()+10
  while not pidfile.exists() and time.time()<until:time.sleep(.02)
  assert pidfile.exists(),mode
  pids=json.loads(pidfile.read_text())
  if mode=='native-exit':
   os.killpg(p.pid,signal.SIGTERM);time.sleep(.1)
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
  p.wait(timeout=40);err=p.stderr.read().decode();p.stdout.read();time.sleep(.2)
  live=[]
  for pid in pids:
   state=subprocess.run(['/bin/ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
   if state and not state.startswith('Z'):live.append(pid)
  if live:
   for pid in live:
    try:os.kill(pid,signal.SIGKILL)
    except ProcessLookupError:pass
  assert not live,(mode,live)
  results.append({'scenario':mode,'elapsedMs':round((time.time()-began)*1000),'ownedDescendantsStopped':len(pids),'exit':p.returncode,'structuredStages':[json.loads(l)['stage'] for l in err.splitlines() if l.startswith('{')]})
out.write_text(json.dumps(results,indent=2));print(out.read_text())
