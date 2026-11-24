import { checkWorkToken, loadAccount, syncAccount } from "./mail-core.mjs";
// Netlify's -background suffix requests are acknowledged immediately and processed asynchronously.
export default async function handler(event){
 try{
  if(event.httpMethod!=="POST")return {statusCode:405};
  const body=JSON.parse(event.body||"{}"),id=String(body.id||"");
  if(!/^[a-f0-9]{64}$/.test(id)||!checkWorkToken(id,event.headers["x-ledgermail-work"]))return {statusCode:403};
  for(let i=0;i<25;i++){
   const account=await loadAccount(id);
   if(!account)break;
   const result=await syncAccount(account);
   if(result.lastError||result.backfillDone)break;
  }
  return {statusCode:200,body:"Done"};
 }catch(e){console.error("Background backfill failed",String(e.message||e).slice(0,150));return {statusCode:500};}
}
