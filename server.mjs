import "dotenv/config"
import OpenAI from "openai"
import express from "express"
import { setTimeout as sleep } from "timers/promises"
import pLimit from "p-limit"

const AGENTS = [
  {name:"qwen32b",   base: process.env.OVH_QWEN32B_BASE,   key: process.env.OVH_API_KEY, model:"Qwen3-32B",                        temp:0.7, max:200},
  {name:"qwencoder", base: process.env.OVH_QWENCODER_BASE, key: process.env.OVH_API_KEY, model:"Qwen3-Coder-30B-A3B-Instruct",     temp:0.5, max:180},
  {name:"llama33",   base: process.env.OVH_LLAMA33_BASE,   key: process.env.OVH_API_KEY, model:"Meta-Llama-3_3-70B-Instruct",      temp:0.7, max:180},
  {name:"llama8b",   base: process.env.OVH_LLAMA8B_BASE,   key: process.env.OVH_API_KEY, model:"Llama-3.1-8B-Instruct",            temp:0.9, max:160},
  {name:"kimi",      base: process.env.OPENROUTER_BASE,     key: process.env.OPENROUTER_API_KEY, model:"moonshotai/kimi-k2-thinking", temp:0.2, max:160}
]

const JUDGE = {name:"judge-qwen32b", base: process.env.OVH_QWEN32B_BASE, key: process.env.OVH_API_KEY, model:"Qwen3-32B", temp:0.1, max:250}
const SYS_OVH = "Réponds en une seule phrase finale, en français, sans analyse ni balises ni préambule."
const SYS_JSON = "Tu dois répondre uniquement en JSON avec les clés winner, scores et justification. winner est le nom d'agent. scores est un tableau d'objets {agent,score} avec score de 0 à 100. justification est une phrase courte en français."
const limit = pLimit(6)

function extractGeneral(s){
  if(!s) return ""
  const m = s.match(/<final>([\s\S]*?)<\/final>/i)
  if(m && m[1]) return m[1].trim()
  let t = s.replace(/<think[\s\S]*?<\/think>/gi,"")
  t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi,"")
  t = t.replace(/<reflection[\s\S]*?<\/reflection>/gi,"")
  t = t.replace(/<[^>]+>/g,"").trim()
  return t
}

function extractKimi(data){
  const c = data?.choices?.[0]?.message || {}
  if (typeof c.content === "string" && c.content.trim().length > 0) return c.content.trim()
  const r = c.reasoning
  if (typeof r === "string" && r.trim().length > 0) {
    const one = r.split(/\r?\n/).filter(x=>x.trim()).pop() || r
    return one.trim()
  }
  const rd = c.reasoning_details?.[0]?.text
  if (typeof rd === "string" && rd.trim().length > 0) {
    const one = rd.split(/\r?\n/).filter(x=>x.trim()).pop() || rd
    return one.trim()
  }
  return ""
}

function finalize(s){
  if(!s) return ""
  let t = s.trim()
  t = t.replace(/^possible answer\s*:\s*/i,"")
  t = t.replace(/^réponse possible\s*:\s*/i,"")
  t = t.replace(/^\"+|\"+$/g,"").replace(/[“”]/g,'"')
  const first = t.split(/(?<=[\\.\\!\\?])\s+/)[0] || t
  const out = first.trim()
  if(/[\.!\\?]$/.test(out)) return out
  return out + "."
}

async function askOpenRouterKimi(a, content){
  const url = a.base.replace(/\/$/,"") + "/chat/completions"
  const payload = {
    model: a.model,
    messages: [
      { role:"system", content:"Tu dois répondre uniquement en JSON avec une clé 'final' contenant une seule phrase en français, sans analyse ni balises." },
      { role:"user", content }
    ],
    max_tokens: a.max,
    temperature: a.temp,
    response_format: { type: "json_object" }
  }
  const r = await fetch(url, {
    method:"POST",
    headers:{
      "Authorization":`Bearer ${a.key}`,
      "Content-Type":"application/json",
      "HTTP-Referer": process.env.OR_REFERER || "https://example.com",
      "X-Title": process.env.OR_TITLE || "ai-debat"
    },
    body: JSON.stringify(payload)
  })
  if(!r.ok) throw new Error(`OpenRouter ${r.status}`)
  const data = await r.json()
  const raw = data?.choices?.[0]?.message?.content || ""
  try {
    const obj = JSON.parse(raw)
    const txt = String(obj.final || "").trim()
    if (txt) return { text: finalize(txt), usage: data.usage || {} }
  } catch {}
  const fallback = extractKimi(data)
  return { text: finalize(fallback), usage: data.usage || {} }
}

async function askOpenRouterGeneric(a, content){
  const url = a.base.replace(/\/$/,"") + "/chat/completions"
  const payload = { model:a.model, messages:[{role:"user",content}], max_tokens:a.max, temperature:a.temp }
  const r = await fetch(url, {
    method:"POST",
    headers:{
      "Authorization":`Bearer ${a.key}`,
      "Content-Type":"application/json",
      "HTTP-Referer": process.env.OR_REFERER || "https://example.com",
      "X-Title": process.env.OR_TITLE || "ai-debat"
    },
    body: JSON.stringify(payload)
  })
  if(!r.ok) throw new Error(`OpenRouter ${r.status}`)
  const data = await r.json()
  const raw = data.choices?.[0]?.message?.content || ""
  return { text: finalize(extractGeneral(raw)), usage: data.usage || {} }
}

async function askOVH(a, content){
  const client = new OpenAI({ baseURL:a.base, apiKey:a.key })
  const r = await client.chat.completions.create({
    model:a.model,
    messages:[
      {role:"system", content:SYS_OVH},
      {role:"user", content}
    ],
    max_tokens:a.max,
    temperature:a.temp
  })
  const raw = r.choices?.[0]?.message?.content || ""
  return { text: finalize(extractGeneral(raw)), usage: r.usage || {} }
}

async function ask(a, content, retry=1){
  try{
    if((a.base||"").includes("openrouter.ai")){
      if(a.name === "kimi") return await askOpenRouterKimi(a, content)
      return await askOpenRouterGeneric(a, content)
    }
    return await askOVH(a, content)
  }catch(e){
    if(retry>0){ await sleep(500); return ask(a, content, retry-1) }
    return { text:"", usage:{}, error:String(e.message||e) }
  }
}

function priceFor(name){
  if(name==="qwen32b")   return {cur:"EUR", pin:+(process.env.PR_QWEN32B_IN||"0.08"),  pout:+(process.env.PR_QWEN32B_OUT||"0.23")}
  if(name==="qwencoder") return {cur:"EUR", pin:+(process.env.PR_QWENCODER_IN||"0.06"),pout:+(process.env.PR_QWENCODER_OUT||"0.22")}
  if(name==="llama33")   return {cur:"EUR", pin:+(process.env.PR_LLAMA33_IN||"0.67"), pout:+(process.env.PR_LLAMA33_OUT||"0.67")}
  if(name==="llama8b")   return {cur:"EUR", pin:+(process.env.PR_LLAMA8B_IN||"0.10"), pout:+(process.env.PR_LLAMA8B_OUT||"0.10")}
  if(name==="kimi")      return {cur:"USD", pin:+(process.env.PR_KIMI_IN||"0.60"),     pout:+(process.env.PR_KIMI_OUT||"2.50")}
  return {cur:"EUR", pin:0, pout:0}
}

function estimateCost(name, usage){
  const p = priceFor(name)
  const tin = +(usage?.prompt_tokens||0)
  const tout = +(usage?.completion_tokens||0)
  const cin = (tin/1e6)*p.pin
  const cout = (tout/1e6)*p.pout
  return { currency:p.cur, input: +cin.toFixed(10), output: +cout.toFixed(10), total: +(cin+cout).toFixed(10) }
}

function aggregateTotals(items){
  const out = {}
  for(const it of items){
    const c = it.cost?.currency||"EUR"
    const t = it.cost?.total||0
    if(!out[c]) out[c]={total:0}
    out[c].total = +(out[c].total + t).toFixed(10)
  }
  return out
}

async function debate(question){
  const calls = AGENTS.map(async a=>{
    const t0 = Date.now()
    const r = await ask(a, question)
    const ms = Date.now()-t0
    const cost = estimateCost(a.name, r.usage)
    return { name:a.name, text:r.text, usage:r.usage, error:r.error||null, ms, cost }
  })
  const answers = await Promise.all(calls)
  const judgeClient = new OpenAI({ baseURL:JUDGE.base, apiKey:JUDGE.key })
  const rubric = {criteria:[{n:"Exactitude",w:0.5},{n:"Raisonnement",w:0.25},{n:"Clarté",w:0.15},{n:"Références",w:0.10}]}
  const pack = {question, answers: answers.map(a=>({agent:a.name,text:a.text})), rubric}
  const j = await judgeClient.chat.completions.create({
    model: JUDGE.model,
    messages: [
      {role:"system", content:SYS_JSON},
      {role:"user", content: JSON.stringify(pack)}
    ],
    max_tokens: JUDGE.max,
    temperature: JUDGE.temp,
    response_format: { type: "json_object" }
  })
  let verdict = {}
  try{ verdict = JSON.parse(j.choices?.[0]?.message?.content || "{}") }catch{ verdict = {winner:null, scores:[], justification:""} }
  const totals = aggregateTotals(answers)
  return { question, answers, totals, verdict }
}

const app = express()
app.use(express.json({ limit:"1mb" }))

app.get("/health",(_,res)=>res.json({ok:true}))
app.post("/debate", async (req,res)=>{
  const q = String(req.body?.question||"").trim()
  if(!q) return res.status(400).json({error:"question manquante"})
  try{
    const result = await debate(q)
    res.json(result)
  }catch(e){
    res.status(500).json({error:String(e.message||e)})
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, ()=>{ console.log("http://localhost:"+PORT) })
