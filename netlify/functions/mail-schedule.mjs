import { configured, listAccountIds, loadAccount, syncAccount } from "../lib/mail-core.mjs";
export const config={schedule:"*/10 * * * *"};
export default async function handler(){
 if(!configured()){console.error("LedgerMail: server Gmail settings missing");return;}
 const ids=await listAccountIds();
 // Schedule processes a bounded account batch to fit Netlify's 30-second limit.
 for(const id of ids.slice(0,3)){
  try{const account=await loadAccount(id);if(account)console.log("Gmail sync",await syncAccount(account));}
  catch(error){console.error("Gmail scheduled sync failed",id,String(error.message||error).slice(0,140));}
 }
}
