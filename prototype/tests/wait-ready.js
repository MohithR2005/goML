export async function waitReady(base) {
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    try{
      const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)});
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('API did not become ready within 60 seconds');
}
