import {deliver} from './index.js';
// Only reachable through the private service binding; one encrypted push per invocation.
export default {
 async fetch(request,env) {
  if(request.method !== 'POST') return new Response(null,{status:405});
  const text=await request.text();
  if(text.length>8192) return new Response(null,{status:413});
  try {const {sub,message,ttl}=JSON.parse(text);return new Response(null,{status:await deliver(env,sub,message,ttl)});}
  catch {return new Response(null,{status:502});}
 }
};
