import "dotenv/config"
import OpenAI from "openai"

const AGENTS = [
  {name:"qwen32b",   base: process.env.OVH_QWEN32B_BASE,   key: process.env.OVH_API_KEY, model:"Qwen3-32B",                        temp:0.7, max:200},
  {name:"qwencoder", base: process.env.OVH_QWENCODER_BASE, key: process.env.OVH_API_KEY, model:"Qwen3-Coder-30B-A3B-Instruct",     temp:0.5, max:180},
  {name:"llama33",   base: process.env.OVH_LLAMA33_BASE,   key: process.env.OVH_API_KEY, model:"Meta-Llama-3_3-70B-Instruct",      temp:0.7, max:180},
  {name:"llama8b",   base: process.env.OVH_LLAMA8B_BASE,   key: process.env.OVH_API_KEY, model:"Llama-3.1-8B-Instruct",            temp:0.9, max:160},
  {name:"kimi",      base: process.env.OPENROUTER_BASE,     key: process.env.OPENROUTER_API_KEY, model:"moonshotai/kimi-k2-thinking", temp:0.2, max:80}
]

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

async function askOpenRouterKimi(a, content){
  const url = a.base.replace(/\/$/,"") + "/chat/completions"
  const payload = {
    model: a.model,
    messages: [
      { role:"system", content:"Tu dois répondre uniquement en JSON avec une clé 'final' contenant une seule phrase en français, sans analyse ni balises." },
      { role:"user", content: content }
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
    if (txt) return { text: txt, usage: data.usage || {} }
  } catch {}
  const fallback = extractKimi(data)
  return { text: fallback, usage: data.usage || {} }
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
  return { text: extractGeneral(raw), usage: data.usage || {} }
}

async function askOVH(a, content){
  const client = new OpenAI({ baseURL:a.base, apiKey:a.key })
  const r = await client.chat.completions.create({
    model:a.model,
    messages:[
      {role:"system", content:"Réponds en une seule phrase finale, en français, sans analyse ni balises ni préambule."},
      {role:"user", content}
    ],
    max_tokens:a.max,
    temperature:a.temp
  })
  const raw = r.choices?.[0]?.message?.content || ""
  return { text: extractGeneral(raw), usage: r.usage || {} }
}

async function ask(a, content){
  if((a.base||"").includes("openrouter.ai")){
    if(a.name === "kimi") return askOpenRouterKimi(a, content)
    return askOpenRouterGeneric(a, content)
  }
  return askOVH(a, content)
}

const q = process.argv.slice(2).join(" ") || "Explique en 1 phrase : quelle est ta spécialité ?"
const out = await Promise.all(AGENTS.map(async a=>{
  const r = await ask(a, q)
  if(!r.text){
    const r2 = await ask(a, "Donne uniquement une phrase finale, sans analyse ni balises.")
    return { name:a.name, text:r2.text || "", usage:r2.usage || r.usage }
  }
  return { name:a.name, text:r.text, usage:r.usage }
}))
console.log(JSON.stringify(out, null, 2))
