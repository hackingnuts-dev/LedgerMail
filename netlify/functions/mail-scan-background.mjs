import { checkWorkToken, loadAccount, syncAccount } from "../lib/mail-core.mjs";
// New Netlify web Request function format. Background invocation returns 202 immediately.
export default async function handler(request){
 try{
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const body=await request.json(),id=String(body.id||"");
  if(!/^[a-f0-9]{64}$/.test(id)||!checkWorkToken(id,request.headers.get("x-ledgermail-work")))return new Response("Forbidden",{status:403});
  for(let i=0;i<25;i++){
   const account=await loadAccount(id);
   if(!account)break;
   const result=await syncAccount(account);
   if(result.lastError||result.backfillDone)break;
  }
  return new Response("Done");
 }catch(e){console.error("Background backfill failed",String(e.message||e).slice(0,150));return new Response("Error",{status:500});}
}
