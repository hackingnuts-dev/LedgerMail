import { configured, baseUrl, oauthUrl, stateTicket, validState, cookie, parseCookies, readTicket, signTicket, connectedAccount, loadAccount, removeAccount, gmail, syncAccount } from "./mail-core.mjs";
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const err=(message,status=400)=>json({error:message},status);
const go=(url,headers={})=>new Response(null,{status:302,headers:{location:url,"cache-control":"no-store",...headers}});
export default async function handler(request){
 try{
  if(!configured())return err("Server Gmail sync is not configured",503);
  const u=new URL(request.url),action=u.searchParams.get("action")||"session";
  const cookies=parseCookies(request);
  if(action==="start"){
   const state=stateTicket();
   return go(oauthUrl(state),{"set-cookie":cookie("lm_oauth",state,600)});
  }
  if(action==="callback"){
   const state=u.searchParams.get("state")||"";
   if(!validState(state)||state!==cookies.lm_oauth)return err("Invalid or expired Google authorization attempt",403);
   if(!u.searchParams.get("code"))return err("Google authorization was cancelled",400);
   const account=await connectedAccount(u.searchParams.get("code"));
   return go(baseUrl()+"/?gmail=connected",{"set-cookie":cookie("lm_session",signTicket(account.id),90*86400)});
  }
  const id=readTicket(cookies.lm_session);
  if(!id)return err("Gmail connection required",401);
  const account=await loadAccount(id);
  if(!account)return err("Account connection no longer exists",401);
  if(action==="session")return json({connected:true,email:account.email,lastSync:account.lastSync,lastError:account.lastError,backfillDone:account.backfillDone,mailCount:account.messages.length},200,{"set-cookie":cookie("lm_session",signTicket(id),90*86400)});
  if(action==="changes"){
   const since=u.searchParams.get("since")||"";
   const limit=Math.min(25,Math.max(1,Number(u.searchParams.get("limit"))||25));
   const pending=account.messages.filter(m=>!since||Number(m._lmSeq)>Number(since)).sort((a,b)=>Number(a._lmSeq)-Number(b._lmSeq));
   const messages=pending.slice(0,limit);
   return json({messages,hasMore:pending.length>limit,lastSync:account.lastSync,lastError:account.lastError,backfillDone:account.backfillDone});
  }
  if(action==="gmail"){
   const path=u.searchParams.get("path")||"";
   if(!/^messages(?:\?|\/[-\w]+\?format=(?:full|minimal|metadata))/.test(path))return err("Invalid Gmail operation",403);
   const data=await gmail(account,path);
   // Do not persist access tokens after proxy requests.
   return json(data);
  }
  if(action==="sync"){
   if(request.method!=="POST")return err("POST required",405);
   if(request.headers.get("origin")!==baseUrl())return err("Invalid origin",403);
   return json(await syncAccount(account));
  }
  if(action==="disconnect"){
   if(request.method!=="POST")return err("POST required",405);
   if(request.headers.get("origin")!==baseUrl())return err("Invalid origin",403);
   await removeAccount(id);
   return json({disconnected:true},200,{"set-cookie":cookie("lm_session","",0)});
  }
  return err("Unknown operation",404);
 }catch(error){
  console.error("LedgerMail backend error",String(error.message||error).slice(0,160));
  return err("Gmail service error: "+String(error.message||error).slice(0,160),500);
 }
}
