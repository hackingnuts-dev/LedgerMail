import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly openid email";
const google = "https://gmail.googleapis.com/gmail/v1/users/me/";
const store = () => getStore("ledgermail-private-v1");
const secret = () => { const s = process.env.LEDGERMAIL_SESSION_SECRET; if (!s || s.length < 32) throw Error("LEDGERMAIL_SESSION_SECRET not configured"); return s; };
const key = () => { const k = Buffer.from(process.env.LEDGERMAIL_DATA_KEY || "", "base64"); if (k.length !== 32) throw Error("LEDGERMAIL_DATA_KEY must be a 32-byte base64 value"); return k; };
const signature = s => createHmac("sha256", secret()).update(s).digest("base64url");
const idFor = email => createHmac("sha256", secret()).update(email.toLowerCase()).digest("hex");
const verify = (value, sig) => { const a=Buffer.from(signature(value)), b=Buffer.from(sig || ""); return a.length === b.length && timingSafeEqual(a,b); };
const pack = data => { const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key(),iv), body=Buffer.concat([cipher.update(JSON.stringify(data),"utf8"),cipher.final()]); return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),body.toString("base64")].join("."); };
const unpack = raw => { const [a,b,c] = raw.split("."); const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(a,"base64")); decipher.setAuthTag(Buffer.from(b,"base64")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(c,"base64")),decipher.final()]).toString("utf8")); };
export const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.LEDGERMAIL_PUBLIC_URL && process.env.LEDGERMAIL_SESSION_SECRET && process.env.LEDGERMAIL_DATA_KEY);
export const baseUrl = () => process.env.LEDGERMAIL_PUBLIC_URL.replace(/\/$/,"");
export const redirectUri = () => baseUrl() + "/.netlify/functions/mail?action=callback";
export const cookie = (name,value,maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
export const parseCookies = req => Object.fromEntries((req.headers.get("cookie") || "").split(";").map(v=>v.trim().split("=")).filter(a=>a.length>=2).map(([k,...v])=>[k,decodeURIComponent(v.join("="))]));
export const signTicket = (id,days=90) => { const data=Buffer.from(JSON.stringify({id, exp:Date.now()+days*864e5})).toString("base64url"); return data+"."+signature(data); };
export const readTicket = raw => { try { const [v,s] = (raw||"").split("."); if(!verify(v,s)) return null; const item=JSON.parse(Buffer.from(v,"base64url")); return item.exp > Date.now() && /^[a-f0-9]{64}$/.test(item.id) ? item.id : null; } catch {return null} };
export const stateTicket = () => { const nonce=randomBytes(18).toString("base64url"), exp=Date.now()+10*60*1000; const value=nonce+"."+exp; return value+"."+signature(value); };
export const validState = raw => { const [n,e,s] = (raw || "").split("."); return Boolean(n && Number(e)>Date.now() && Number(e)<Date.now()+600001 && verify(n+"."+e,s)); };
export const oauthUrl = state => { const u=new URL("https://accounts.google.com/o/oauth2/v2/auth"); for(const [k,v] of Object.entries({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri(),response_type:"code",scope:SCOPE,access_type:"offline",prompt:"consent",state}))u.searchParams.set(k,v);return u.toString(); };
export async function tokenExchange(form) {
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(form)});
  const out=await res.json(); if(!res.ok) throw Error("Google OAuth exchange failed: "+String(out.error||res.status)); return out;
}
export async function saveAccount(account) { await store().set("account/"+account.id,pack(account)); }
export async function loadAccount(id) { const v=await store().get("account/"+id,{type:"text",consistency:"strong"});return v?unpack(v):null; }
export async function removeAccount(id){await store().delete("account/"+id);}
export async function connectedAccount(code) {
 const token=await tokenExchange({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri(),grant_type:"authorization_code"});
 if(!token.refresh_token) throw Error("Google did not issue offline access. Reauthorize with consent.");
 const who=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:"Bearer "+token.access_token}});
 if(!who.ok)throw Error("Unable to verify Google account");
 const profile=await who.json();
 if(!profile.email_verified || !profile.email)throw Error("Google email identity could not be verified");
 const id=idFor(profile.email), prior=await loadAccount(id);
 const account={id,email:profile.email.toLowerCase(),refresh:token.refresh_token,expires:0,access:"",historyId:prior?.historyId||null,baselineId:prior?.baselineId||null,backfillCursor:prior?.backfillCursor||null,backfillDone:prior?.backfillDone||false,messages:prior?.messages||[],lastSync:prior?.lastSync||null,lastError:null};
 await saveAccount(account); return account;
}
export async function accessToken(account) {
 if(account.access && account.expires > Date.now()+60000)return account.access;
 const tok=await tokenExchange({refresh_token:account.refresh,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,grant_type:"refresh_token"});
 account.access=tok.access_token;account.expires=Date.now()+(Number(tok.expires_in)||3600)*1000;
 if(tok.refresh_token)account.refresh=tok.refresh_token;
 return account.access;
}
export async function gmail(account,path) {
 const token=await accessToken(account);
 const res=await fetch(google+path,{headers:{authorization:"Bearer "+token,accept:"application/json"}});
 if(res.status===401)throw Error("Google Gmail authorization revoked; reconnect required");
 if(res.status===429 || res.status>=500)throw Error("Transient Gmail error "+res.status);
 const body=await res.json().catch(()=>({}));
 if(!res.ok){ const err=Error("Gmail error "+res.status);err.status=res.status;throw err; }
 return body;
}
const recent = () => {const d=new Date(Date.now()-32*864e5);return d.toISOString().slice(0,10).replace(/-/g,"/");};
const addMessages=async(account,ids) => {
 const old=new Set(account.messages.map(m=>m.id));
 for(const id of [...new Set(ids)].filter(x=>x&&!old.has(x)).slice(0,30)){
  const m=await gmail(account,"messages/"+encodeURIComponent(id)+"?format=full");
  // Store mail only for the owner's account, encrypted at rest.
  account.messages.push(m);old.add(id);
 }
 account.messages=account.messages.slice(-500);
};
export async function syncAccount(account){
 const started=Date.now();
 try {
  if(!account.backfillDone){
   if(!account.baselineId){const p=await gmail(account,"profile"); account.baselineId=p.historyId;}
   const query="after:"+recent();
   const path="messages?maxResults=30&q="+encodeURIComponent(query)+(account.backfillCursor?"&pageToken="+encodeURIComponent(account.backfillCursor):"");
   const page=await gmail(account,path);
   await addMessages(account,(page.messages||[]).map(x=>x.id));
   account.backfillCursor=page.nextPageToken||null;
   if(!account.backfillCursor){account.backfillDone=true;account.historyId=account.baselineId;}
  }else{
   const start=account.historyId;
   if(!start){account.backfillDone=false;}
   else{
    try{
     const page=await gmail(account,"history?startHistoryId="+encodeURIComponent(start)+"&historyTypes=messageAdded&maxResults=100");
     const ids=(page.history||[]).flatMap(h=>(h.messagesAdded||[]).map(x=>x.message?.id));
     await addMessages(account,ids);
     // Never advance the cursor across unprocessed pages.
     if(!page.nextPageToken)account.historyId=page.historyId||start;
     else{
      account.backfillDone=false;account.backfillCursor=null;account.baselineId=start;
     }
    }catch(e){if(e.status===404){account.backfillDone=false;account.backfillCursor=null;account.baselineId=null;}else throw e;}
   }
  }
  account.lastSync=new Date().toISOString(); account.lastError=null;
 }catch(e){account.lastError=String(e.message||e).slice(0,200);}
 // No refresh tokens or access tokens are exposed to the browser.
 account.access="";account.expires=0;
 await saveAccount(account);
 return {email:account.email,lastSync:account.lastSync,lastError:account.lastError,count:account.messages.length,durationMs:Date.now()-started,backfillDone:account.backfillDone};
}
export async function listAccountIds(){const result=await store().list({prefix:"account/"});return result.blobs.map(x=>x.key.slice(8));}
