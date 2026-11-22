// Remove ONLY disposable restore databases created by this consolidation run.
// Never deletes the canonical, dev, test or any unrecognised database.
const fs=require('node:fs'),path=require('node:path');
const {root}=require('./consolidateDatabases');
const {connect}=require('./learningDevEnvironment');
const {readSnapshot,compact,quote,write}=require('./consolidateDatabases');
async function main(){
  const targets=[];
  for(const name of fs.readdirSync(root)){
    const dir=path.join(root,name),file=path.join(dir,'manifest.json');if(!fs.existsSync(file))continue;
    for(const [origin,entry]of Object.entries(JSON.parse(fs.readFileSync(file)).databases)){
      const staged=path.join(dir,'staging.after.json');
      const restored=path.join(dir,origin+'.restored.json');
      const evidence=origin==='toeic_learning_system'&&fs.existsSync(staged)?staged:restored;
      if(!fs.existsSync(evidence))throw Error('Missing restore evidence');
      targets.push({name:entry.restored_database,evidence});
    }
  }
  // First failed v17 restore stopped at SET transaction_timeout before creating tables.
  targets.push({name:'toeic_verify_main_1795099662288',empty:true});
  const c=await connect('postgres'),removed=[];
  try{
    for(const t of targets){
      if(!/^toeic_verify_(main|dev)_\d+$/.test(t.name))throw Error('Unrecognised restore name');
      if(!(await c.query('SELECT 1 FROM pg_database WHERE datname=$1',[t.name])).rowCount)continue;
      if((await c.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1',[t.name])).rowCount)throw Error('Restore database is in use; leaving intact: '+t.name);
      const actual=await readSnapshot(t.name);
      if(t.empty?Object.keys(actual.tables).length!==0:JSON.stringify(compact(actual))!==JSON.stringify(compact(JSON.parse(fs.readFileSync(t.evidence)))))throw Error('Restore copy changed; leaving intact: '+t.name);
      await c.query('DROP DATABASE '+quote(t.name));removed.push(t.name);
    }
  }finally{await c.end();}
  write(path.join(root,'restore_cleanup.json'),{removed,canonical_and_dev_untouched:true,backups_and_restore_proofs_retained:true});
  console.log(JSON.stringify({removed,canonical_and_dev_untouched:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
